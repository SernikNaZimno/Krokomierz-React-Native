import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Pedometer } from 'expo-sensors';
import * as SQLite from 'expo-sqlite';
import { Picker } from '@react-native-picker/picker';

// Opcje dla naszej listy rozwijanej
const PERIODS = {
  WEEK: { label: 'Ostatni Tydzień', sqlModifier: '-7 days' },
  MONTH: { label: 'Ostatni Miesiąc', sqlModifier: '-1 month' },
  QUARTER: { label: 'Ostatni Kwartał', sqlModifier: '-3 months' },
  YEAR: { label: 'Ostatni Rok', sqlModifier: '-1 year' },
};

export default function HomeScreen() {
  const [stepCount, setStepCount] = useState(0);
  const [isPedometerAvailable, setIsPedometerAvailable] = useState('Sprawdzanie...');
  
  // Stan dla statystyk
  const [selectedPeriod, setSelectedPeriod] = useState<keyof typeof PERIODS>('WEEK');
  // Zastąpiliśmy stare periodTotalSteps nową zmienną historicalSteps
  const [historicalSteps, setHistoricalSteps] = useState(0);
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
                  `INSERT INTO daily_steps (date, steps) VALUES (date('now'), ?)
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

  // 3. Pobieranie statystyk historycznych (z Debouncem)
  useEffect(() => {
    if (!db || !isDbReady) return;
    
    let isCancelled = false; 
    
    const fetchHistoricalStats = async () => {
      try {
        const modifier = PERIODS[selectedPeriod]?.sqlModifier || '-7 days';
        
        const result = await db.getAllAsync<{ total: number }>(
          `SELECT SUM(steps) as total FROM daily_steps WHERE date >= date('now', '${modifier}') AND date < date('now')`
        );
        
        if (!isCancelled) {
          setHistoricalSteps(result[0]?.total || 0);
        }
      } catch (error) {
        console.error("Błąd podczas przeliczania statystyk: ", error);
      }
    };

    const timeoutId = setTimeout(() => {
      fetchHistoricalStats();
    }, 150);

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [selectedPeriod, isDbReady, db]);

  // Ekran ładowania
  if (!isDbReady) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#2e8b57" />
        <Text>Ładowanie bazy danych...</Text>
      </View>
    );
  }

  // Główny widok
  return (
    <View style={styles.container}>
      {/* SEKCJA 1: Wynik na żywo */}
      <View style={styles.todayCard}>
        <Text style={styles.title}>Dzisiejsze kroki</Text>
        <Text style={styles.steps}>{stepCount}</Text>
        <Text style={styles.status}>Status czujnika: {isPedometerAvailable}</Text>
      </View>

      {/* SEKCJA 2: Statystyki historyczne */}
      <View style={styles.statsCard}>
        <Text style={styles.statsTitle}>Statystyki Historyczne</Text>
        
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

        <Text style={styles.periodResult}>
          Suma kroków: <Text style={styles.periodTotal}>{historicalSteps + stepCount}</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
  },
  todayCard: {
    backgroundColor: '#fff',
    padding: 30,
    borderRadius: 20,
    alignItems: 'center',
    marginBottom: 20,
    elevation: 4, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  title: { fontSize: 20, color: '#666' },
  steps: { fontSize: 72, fontWeight: 'bold', color: '#2e8b57', marginVertical: 10 },
  status: { fontSize: 12, color: '#999' },
  
  statsCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  statsTitle: { fontSize: 18, fontWeight: '600', marginBottom: 15, textAlign: 'center' },
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 20,
  },
  picker: { height: 50, width: '100%' },
  periodResult: { fontSize: 16, textAlign: 'center', color: '#555' },
  periodTotal: { fontSize: 24, fontWeight: 'bold', color: '#333' },
});