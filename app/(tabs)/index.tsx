import { Picker } from '@react-native-picker/picker';
import { Pedometer } from 'expo-sensors';
import * as SQLite from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

const PERIODS = {
  WEEK: { label: 'Ostatni Tydzień', sqlModifier: '-7 days' },
  MONTH: { label: 'Ostatni Miesiąc', sqlModifier: '-1 month' },
};

// Interfejs dla danych z bazy
interface DailyStats {
  date: string;
  total: number;
}

export default function HomeScreen() {
  const [stepCount, setStepCount] = useState(0);
  const [isPedometerAvailable, setIsPedometerAvailable] = useState('Sprawdzanie...');
  
  const [selectedPeriod, setSelectedPeriod] = useState<keyof typeof PERIODS>('WEEK');
  const [historicalData, setHistoricalData] = useState<DailyStats[]>([]);
  const [isDbReady, setIsDbReady] = useState(false);
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);

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
        console.error("Błąd inicjalizacji bazy danych: ", error);
      }
    };

    setupDatabase();
  }, []);

  // 2. Obsługa Krokomierza i zapis na żywo
  useEffect(() => {
    if (!isDbReady || !db) return;

    let subscription: Pedometer.Subscription | null = null;

    const startPedometer = async () => {
      try {
        const permission = await Pedometer.requestPermissionsAsync();
        if (permission.granted) {
          const isAvailable = await Pedometer.isAvailableAsync();
          setIsPedometerAvailable(isAvailable ? 'Dostępny' : 'Brak sprzętu');

          if (isAvailable) {
            subscription = Pedometer.watchStepCount(async (result) => {
              setStepCount(result.steps);
              
              // Zapis do bazy w czasie rzeczywistym
              try {
                await db.runAsync(
                  `INSERT INTO daily_steps (date, steps) VALUES (date('now', 'localtime'), ?)
                   ON CONFLICT(date) DO UPDATE SET steps = ?`,
                  [result.steps, result.steps]
                );
              } catch (err) {
                console.error("Błąd zapisu kroków: ", err);
              }
            });
          }
        } else {
          setIsPedometerAvailable('Brak uprawnień');
        }
      } catch (error) {
        console.error("Błąd krokomierza: ", error);
      }
    };

    startPedometer();

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [isDbReady, db]);

  // 3. Pobieranie danych do wykresu
  useEffect(() => {
    if (!db || !isDbReady) return;
    let isCancelled = false; 
    
    const fetchHistoricalStats = async () => {
      try {
        const modifier = PERIODS[selectedPeriod]?.sqlModifier || '-7 days';
        // Grupujemy po dacie, aby uzyskać dane dla każdego słupka wykresu
        const result = await db.getAllAsync<DailyStats>(
          `SELECT date, SUM(steps) as total 
           FROM daily_steps 
           WHERE date >= date('now', 'localtime', '${modifier}') 
           GROUP BY date 
           ORDER BY date ASC`
        );
        
        if (!isCancelled) {
          setHistoricalData(result);
        }
      } catch (error) {
        console.error("Błąd podczas pobierania statystyk: ", error);
      }
    };

    const timeoutId = setTimeout(fetchHistoricalStats, 150);
    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [selectedPeriod, isDbReady, db, stepCount]); // Dodano stepCount do zależności, aby wykres odświeżał się na żywo

  // Funkcja rysująca wykres słupkowy
  const renderChart = () => {
    if (historicalData.length === 0) {
      return <Text style={styles.noDataText}>Brak danych z tego okresu.</Text>;
    }

    // Znajdujemy maksymalną wartość, aby ustalić proporcje słupków
    const maxSteps = Math.max(...historicalData.map(d => d.total), 1);

    return (
      <View style={styles.chartContainer}>
        {historicalData.slice(-7).map((day, index) => { // Pokazujemy max 7 ostatnich dni dla czytelności
          const heightPercent = (day.total / maxSteps) * 100;
          const dateLabel = day.date.substring(5); // Format MM-DD
          
          return (
            <View key={index} style={styles.barWrapper}>
              <View style={styles.barBackground}>
                <View style={[styles.barFill, { height: `${heightPercent}%` }]} />
              </View>
              <Text style={styles.barLabel}>{dateLabel}</Text>
            </View>
          );
        })}
      </View>
    );
  };

  if (!isDbReady) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#2e8b57" />
        <Text style={{marginTop: 10}}>Ładowanie bazy danych...</Text>
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
  loaderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  
  todayCard: {
    backgroundColor: '#fff',
    padding: 30,
    borderRadius: 24,
    alignItems: 'center',
    marginBottom: 20,
    elevation: 6, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  title: { fontSize: 18, color: '#64748b', fontWeight: '500' },
  steps: { fontSize: 84, fontWeight: '800', color: '#10b981', marginVertical: 10, letterSpacing: -2 },
  status: { fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', fontWeight: '600' },
  
  statsCard: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 24,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  statsTitle: { fontSize: 18, fontWeight: '700', marginBottom: 15, textAlign: 'center', color: '#1e293b' },
  pickerContainer: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
  },
  picker: { height: 50, width: '100%' },
  
  // Style Wykresu
  chartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 150,
    paddingTop: 10,
  },
  barWrapper: {
    alignItems: 'center',
    flex: 1,
  },
  barBackground: {
    width: 20,
    height: 120,
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 10,
  },
  barLabel: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 8,
  },
  noDataText: {
    textAlign: 'center',
    color: '#94a3b8',
    fontStyle: 'italic',
    paddingVertical: 30,
  }
});