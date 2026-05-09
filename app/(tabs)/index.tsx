import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { Pedometer } from 'expo-sensors';
import * as SQLite from 'expo-sqlite';
import { Picker } from '@react-native-picker/picker';
import { FontAwesome5 } from '@expo/vector-icons';

const PERIODS = {
  WEEK: { label: 'Ostatni Tydzień', sqlModifier: '-7 days', mode: 'daily' },
  MONTH: { label: 'Ostatni Miesiąc', sqlModifier: '-1 month', mode: 'daily' },
  QUARTER: { label: 'Ostatni Kwartał', sqlModifier: '-3 months', mode: 'daily' },
  YEAR: { label: 'Ostatni Rok', sqlModifier: '-1 year', mode: 'monthly' },
};

const STEP_LENGTH_M = 0.762; // Średnia długość kroku w metrach
const KCAL_PER_STEP = 0.04;  // Średnia ilość spalanych kalorii na krok

interface ChartData {
  label: string;
  total: number;
}

export default function HomeScreen() {
  // Stan Krokomierza i Statystyk
  const [sessionSteps, setSessionSteps] = useState(0);
  const [savedTodaySteps, setSavedTodaySteps] = useState(0);
  const [isPedometerAvailable, setIsPedometerAvailable] = useState('Sprawdzanie...');
  
  // Cele i Ustawienia
  const [dailyGoal, setDailyGoal] = useState(10000);
  
  // Stan Wykresu i Bazy
  const [selectedPeriod, setSelectedPeriod] = useState<keyof typeof PERIODS>('WEEK');
  const [historicalData, setHistoricalData] = useState<ChartData[]>([]);
  const [isDbReady, setIsDbReady] = useState(false);
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [isLoadingChart, setIsLoadingChart] = useState(false);

  // Zmienna chroniąca przed "wyścigami" zapytań (Race conditions)
  const queryVersion = useRef(0);

  const totalStepsToday = savedTodaySteps + sessionSteps;
  const distanceKm = ((totalStepsToday * STEP_LENGTH_M) / 1000).toFixed(2);
  const burnedKcal = (totalStepsToday * KCAL_PER_STEP).toFixed(0);
  const progressPercent = Math.min((totalStepsToday / dailyGoal) * 100, 100);

  // 1. Inicjalizacja Bazy Danych
  useEffect(() => {
    const setupDatabase = async () => {
      try {
        const database = await SQLite.openDatabaseAsync('krokomierz.db');
        setDb(database);
        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS daily_steps (
            date TEXT PRIMARY KEY,
            steps INTEGER
          );
        `);
        setIsDbReady(true);
      } catch (error) {
        console.error("Błąd bazy danych: ", error);
      }
    };
    setupDatabase();
  }, []);

  // 2. Obsługa Krokomierza
  useEffect(() => {
    if (!isDbReady || !db) return;
    let subscription: Pedometer.Subscription | null = null;

    const startPedometer = async () => {
      try {
        // Wczytanie kroków z dzisiaj przy uruchomieniu
        const todayRecord = await db.getFirstAsync<{ steps: number }>(
          `SELECT steps FROM daily_steps WHERE date = date('now', 'localtime')`
        );
        if (todayRecord) setSavedTodaySteps(todayRecord.steps);

        const isAvailable = await Pedometer.isAvailableAsync();
        if (!isAvailable) {
          setIsPedometerAvailable('Brak sprzętu');
          return;
        }

        const permission = await Pedometer.requestPermissionsAsync();
        
        if (permission.granted) {
          setIsPedometerAvailable('Dostępny');
          
          subscription = Pedometer.watchStepCount(async (result) => {
            setSessionSteps(result.steps);
            const currentTotal = (todayRecord ? todayRecord.steps : 0) + result.steps;
            
            try {
              // Zapisujemy połączone kroki (z bazy + z obecnej sesji)
              await db.runAsync(
                `INSERT INTO daily_steps (date, steps) VALUES (date('now', 'localtime'), ?)
                 ON CONFLICT(date) DO UPDATE SET steps = ?`,
                [currentTotal, currentTotal]
              );
            } catch (err) {
              console.log("Błąd zapisu: ", err);
            }
          });
        } else {
          setIsPedometerAvailable('Brak uprawnień');
        }
      } catch (error) {
        console.error("Błąd czujnika: ", error);
        setIsPedometerAvailable('Błąd czujnika');
      }
    };

    startPedometer();
    return () => {
      if (subscription) subscription.remove();
    };
  }, [isDbReady, db]);

  // 3. Pobieranie danych do wykresu (Odporne na crashe i szybkie kliknięcia)
  useEffect(() => {
    if (!db || !isDbReady) return;
    
    queryVersion.current += 1;
    const currentVersion = queryVersion.current;
    
    const fetchHistoricalStats = async () => {
      setIsLoadingChart(true);
      try {
        const periodConfig = PERIODS[selectedPeriod];
        let query = '';

        if (periodConfig.mode === 'monthly') {
          query = `
            SELECT strftime('%Y-%m', date) as label, SUM(steps) as total 
            FROM daily_steps 
            WHERE date >= date('now', 'localtime', '${periodConfig.sqlModifier}') 
            GROUP BY label 
            ORDER BY label ASC
          `;
        } else {
          query = `
            SELECT date as label, SUM(steps) as total 
            FROM daily_steps 
            WHERE date >= date('now', 'localtime', '${periodConfig.sqlModifier}') 
            GROUP BY label 
            ORDER BY label ASC
          `;
        }
        
        const result = await db.getAllAsync<ChartData>(query);
        
        // Aktualizujemy stan TYLKO jeśli to zapytanie jest nadal najnowsze
        if (currentVersion === queryVersion.current) {
          setHistoricalData(result || []);
        }
      } catch (error) {
        if (currentVersion === queryVersion.current) setHistoricalData([]);
      } finally {
        if (currentVersion === queryVersion.current) setIsLoadingChart(false);
      }
    };

    const timeoutId = setTimeout(fetchHistoricalStats, 300); // Delikatny debounce
    return () => clearTimeout(timeoutId);
  }, [selectedPeriod, isDbReady, db, totalStepsToday]); // totalStepsToday odświeża wykres na żywo

  // 4. Renderowanie Wykresu
  const renderChart = () => {
    if (isLoadingChart) {
      return (
        <View style={styles.chartLoadingContainer}>
          <ActivityIndicator size="small" color="#3b82f6" />
        </View>
      );
    }

    if (historicalData.length === 0) {
      return <Text style={styles.noDataText}>Brak aktywności w tym okresie.</Text>;
    }

    // Bezpieczne sprawdzanie MAX - zapobiega crashom gdy total to null/undefined
    const maxSteps = historicalData.reduce((max, day) => Math.max(max, Number(day.total) || 0), 1);

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartScrollContainer}>
        {historicalData.map((data, index) => {
          const safeTotal = Number(data.total) || 0;
          const heightPercent = (safeTotal / maxSteps) * 100;
          const displayLabel = data.label.substring(5); 

          return (
            <View key={index} style={styles.barWrapper}>
              <View style={styles.barBackground}>
                {heightPercent > 0 && (
                  <View style={[styles.barFill, { height: `${heightPercent}%` }]} />
                )}
              </View>
              <Text style={styles.barLabel}>{displayLabel}</Text>
              <Text style={styles.barValue}>{safeTotal > 0 ? safeTotal : ''}</Text>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  if (!isDbReady) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Sekcja Dzisiejsza */}
      <View style={styles.todayCard}>
        <Text style={styles.title}>Dzisiejsza Aktywność</Text>
        
        {/* Progress Bar i Kroki */}
        <View style={styles.progressCircleContainer}>
          <Text style={styles.steps}>{totalStepsToday}</Text>
          <Text style={styles.goalText}>/ {dailyGoal} kroków</Text>
          <View style={styles.progressBarBackground}>
            <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
          </View>
        </View>

        {/* Statystyki: Dystans i Kalorie */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <FontAwesome5 name="route" size={20} color="#3b82f6" />
            <Text style={styles.statValue}>{distanceKm} km</Text>
          </View>
          <View style={styles.statBox}>
            <FontAwesome5 name="fire-alt" size={20} color="#ef4444" />
            <Text style={styles.statValue}>{burnedKcal} kcal</Text>
          </View>
        </View>
        
        <Text style={styles.status}>Status czujnika: {isPedometerAvailable}</Text>
      </View>

      {/* Sekcja Wykresu */}
      <View style={styles.statsCard}>
        <Text style={styles.statsTitle}>Historia Aktywności</Text>
        <View style={styles.pickerContainer}>
          <Picker
            selectedValue={selectedPeriod}
            onValueChange={(itemValue) => setSelectedPeriod(itemValue as keyof typeof PERIODS)}
            style={styles.picker}
          >
            {Object.entries(PERIODS).map(([key, data]) => (
              <Picker.Item key={key} label={data.label} value={key} />
            ))}
          </Picker>
        </View>
        {renderChart()}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8', padding: 15 },
  center: { justifyContent: 'center', alignItems: 'center' },
  
  todayCard: {
    backgroundColor: '#fff',
    padding: 25,
    borderRadius: 24,
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 20,
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12,
  },
  title: { fontSize: 18, color: '#64748b', fontWeight: '700', marginBottom: 15 },
  
  progressCircleContainer: { alignItems: 'center', width: '100%', marginBottom: 25 },
  steps: { fontSize: 64, fontWeight: '800', color: '#10b981', letterSpacing: -2 },
  goalText: { fontSize: 16, color: '#94a3b8', fontWeight: '600', marginBottom: 15 },
  progressBarBackground: { width: '100%', height: 12, backgroundColor: '#e2e8f0', borderRadius: 10, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#10b981', borderRadius: 10 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginBottom: 20 },
  statBox: { alignItems: 'center', backgroundColor: '#f8fafc', padding: 15, borderRadius: 16, width: '45%' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#1e293b', marginTop: 8 },
  
  status: { fontSize: 11, color: '#cbd5e1', textTransform: 'uppercase', fontWeight: '600' },
  
  statsCard: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 24,
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12,
  },
  statsTitle: { fontSize: 18, fontWeight: '700', marginBottom: 15, textAlign: 'center', color: '#1e293b' },
  pickerContainer: { backgroundColor: '#f8fafc', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  picker: { height: 50, width: '100%' },
  
  chartScrollContainer: { alignItems: 'flex-end', height: 180, paddingTop: 20, paddingBottom: 10 },
  chartLoadingContainer: { height: 180, justifyContent: 'center', alignItems: 'center' },
  barWrapper: { alignItems: 'center', marginHorizontal: 8, width: 36 },
  barBackground: { width: 24, height: 120, backgroundColor: '#e2e8f0', borderRadius: 12, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: '#3b82f6', borderRadius: 12 },
  barLabel: { fontSize: 11, color: '#64748b', marginTop: 8, fontWeight: '600' },
  barValue: { fontSize: 9, color: '#94a3b8', position: 'absolute', top: -15, fontWeight: 'bold' },
  noDataText: { textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', paddingVertical: 40 }
});