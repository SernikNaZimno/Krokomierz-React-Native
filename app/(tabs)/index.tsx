import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pedometer } from 'expo-sensors';

export default function HomeScreen() {
  const [stepCount, setStepCount] = useState(0);
  const [isPedometerAvailable, setIsPedometerAvailable] = useState('Sprawdzanie...');

  useEffect(() => {
    let subscription: Pedometer.Subscription | null = null;

    const startPedometer = async () => {
      // Prosimy o uprawnienia do śledzenia aktywności fizycznej
      const permission = await Pedometer.requestPermissionsAsync();
      
      if (permission.granted) {
        // Sprawdzamy, czy telefon fizycznie posiada czujnik kroków
        const isAvailable = await Pedometer.isAvailableAsync();
        setIsPedometerAvailable(String(isAvailable));

        if (isAvailable) {
          // Nasłuchujemy kroków w czasie rzeczywistym
          subscription = Pedometer.watchStepCount(result => {
            setStepCount(result.steps);
          });
        }
      } else {
        setIsPedometerAvailable('Brak uprawnień');
      }
    };

    startPedometer();

    // Czyszczenie nasłuchiwania przy wyjściu z ekranu
    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Twój dzisiejszy wynik</Text>
      <Text style={styles.steps}>{stepCount}</Text>
      <Text style={styles.subtitle}>kroków</Text>
      
      <Text style={styles.status}>Status czujnika: {isPedometerAvailable}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5', // Lekko szare tło dla lepszego wyglądu
  },
  title: {
    fontSize: 20,
    color: '#666',
  },
  steps: {
    fontSize: 80,
    fontWeight: 'bold',
    color: '#2e8b57', // Zielony kolor dla statystyk
    marginVertical: 10,
  },
  subtitle: {
    fontSize: 24,
    color: '#333',
  },
  status: {
    marginTop: 40,
    fontSize: 12,
    color: '#999',
  }
});