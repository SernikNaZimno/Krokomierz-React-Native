import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, ScrollView } from 'react-native';
import { Pedometer } from 'expo-sensors';
import * as SQLite from 'expo-sqlite';
import { Picker } from '@react-native-picker/picker';

// Tryb 'daily' pokazuje każdy dzień, 'monthly' grupuje dni w miesiące
const PERIODS = {
  WEEK: { label: 'Ostatni Tydzień', sqlModifier: '-7 days', mode: 'daily' },
  MONTH: { label: 'Ostatni Miesiąc', sqlModifier: '-1 month', mode: 'daily' },
  QUARTER: { label: 'Ostatni Kwartał', sqlModifier: '-3 months', mode: 'daily' },
  YEAR: { label: 'Ostatni Rok', sqlModifier: '-1 year', mode: 'monthly' },
};

interface ChartData {
  label: string;
  total: number;
}

export default function HomeScreen() {
  const [stepCount, setStepCount] = useState(0);
  const [isPedometerAvailable, setIsPedometerAvailable] = useState('Sprawdzanie...');
  
  const [selectedPeriod, setSelectedPeriod] = useState<keyof typeof PERIODS>('WEEK');
  const [historicalData, setHistoricalData] = useState<ChartData[]>([]);
  const [isDbReady, setIsDbReady] = useState(false);
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [isLoadingChart, setIsLoadingChart] = useState(false);

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
    let retryCount = 0;
    const maxRetries = 3;

    const startPedometer = async () => {
      try {
        // Check status najpierw
        const isAvailable = await Pedometer.isAvailableAsync();
        
        if (!isAvailable) {
          setIsPedometerAvailable('Brak sprzętu');
          return;
        }

        // Request permissions z retry logiką
        let permission = await Pedometer.requestPermissionsAsync();
        
        while (!permission.granted && retryCount < maxRetries) {
          retryCount++;
          console.warn(`Retry uprawnień (${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 500));
          permission = await Pedometer.requestPermissionsAsync();
        }

        if (permission.granted) {
          setIsPedometerAvailable('Dostępny');
          subscription = Pedometer.watchStepCount(async (result) => {
            setStepCount(result.steps);
            try {
              await db.runAsync(
                `INSERT INTO daily_steps (date, steps) VALUES (date('now', 'localtime'), ?)
                 ON CONFLICT(date) DO UPDATE SET steps = ?`,
                [result.steps, result.steps]
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

  // 3. Pobieranie danych do wykresu (Stabilna obsługa bez crashów)
  useEffect(() => {
    if (!db || !isDbReady) return;
    let isCancelled = false;
    let timeoutId: NodeJS.Timeout;
    
    const fetchHistoricalStats = async () => {
      if (isCancelled) return;
      
      setIsLoadingChart(true);
      try {
        const periodConfig = PERIODS[selectedPeriod];
        let query = '';

        // Sprytne grupowanie: jeśli wybraliśmy rok, grupujemy po miesiącu (np. 2023-10)
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
        
        if (!isCancelled && result) {
          setHistoricalData(result || []);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error("Błąd statystyk: ", error);
          setHistoricalData([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingChart(false);
        }
      }
    };

    // Debounce 500ms + longer timeout to prevent query stacking
    timeoutId = setTimeout(fetchHistoricalStats, 500);
    
    return () => { 
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [selectedPeriod, isDbReady, db]);

  // 4. Renderowanie wykresu Garmin-style
  const renderChart = () => {
    if (isLoadingChart) {
      return (
        <View style={styles.chartLoadingContainer}>
          <ActivityIndicator size="small" color="#3b82f6" />
          <Text style={styles.loadingText}>Ładowanie wykresu...</Text>
        </View>
      );
    }

    if (historicalData.length === 0) {
      return <Text style={styles.noDataText}>Brak aktywności w tym okresie.</Text>;
    }

    // Używamy reduce zamiast Math.max(...array) co zapobiega crashom przy dużych zakresach danych
    const maxSteps = historicalData.reduce((max, day) => Math.max(max, day.total), 1);

    return (
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chartScrollContainer}
      >
        {historicalData.map((data, index) => {
          const heightPercent = (data.total / maxSteps) * 100;
          // Usuwamy rok z etykiety dla lepszej czytelności (zostaje MM-DD lub MM)
          const displayLabel = data.label.substring(5); 

          return (
            <View key={index} style={styles.barWrapper}>
              <View style={styles.barBackground}>
                {/* Warunek heightPercent > 0 usuwa "ducha-słupka" */}
                {heightPercent > 0 && (
                  <View style={[styles.barFill, { height: `${heightPercent}%` }]} />
                )}
              </View>
              <Text style={styles.barLabel}>{displayLabel}</Text>
              <Text style={styles.barValue}>{data.total > 0 ? data.total : ''}</Text>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  if (!isDbReady) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#2e8b57" />
        <Text style={{marginTop: 10}}>Inicjalizacja...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.todayCard}>
        <Text style={styles.title}>Suma kroków (Dzisiaj)</Text>
        <Text style={styles.steps}>{stepCount}</Text>
        <Text style={styles.status}>Sensor: {isPedometerAvailable}</Text>
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f0f4f8', justifyContent: 'center' },
  center: { alignItems: 'center' },
  
  todayCard: {
    backgroundColor: '#fff',
    padding: 30,
    borderRadius: 24,
    alignItems: 'center',
    marginBottom: 20,
    elevation: 6, 
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12,
  },
  title: { fontSize: 18, color: '#64748b', fontWeight: '500' },
  steps: { fontSize: 84, fontWeight: '800', color: '#10b981', marginVertical: 10 },
  status: { fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', fontWeight: '600' },
  
  statsCard: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 24,
    elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12,
  },
  statsTitle: { fontSize: 18, fontWeight: '700', marginBottom: 15, textAlign: 'center', color: '#1e293b' },
  pickerContainer: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 10,
  },
  picker: { height: 50, width: '100%' },
  
  // Style przewijanego wykresu (Garmin/Apple Health style)
  chartScrollContainer: {
    alignItems: 'flex-end',
    height: 180,
    paddingTop: 20,
    paddingBottom: 10,
  },
  chartLoadingContainer: {
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 12,
    color: '#94a3b8',
  },
  barWrapper: {
    alignItems: 'center',
    marginHorizontal: 8,
    width: 36,
  },
  barBackground: {
    width: 24,
    height: 120,
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 12,
  },
  barLabel: { fontSize: 11, color: '#64748b', marginTop: 8, fontWeight: '600' },
  barValue: { fontSize: 9, color: '#94a3b8', position: 'absolute', top: -15, fontWeight: 'bold' },
  noDataText: { textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', paddingVertical: 40 }
});