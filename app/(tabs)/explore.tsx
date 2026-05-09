import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import MapView, { Marker, Polygon, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';

// --------------------------------------------------
// LOGIKA SIATKI I MGŁY WOJNY
// --------------------------------------------------
const GRID_SIZE = 0.0005;

const MASK_BOUNDS = [
  { latitude: 55.0, longitude: 14.0 }, 
  { latitude: 55.0, longitude: 25.0 }, 
  { latitude: 49.0, longitude: 25.0 }, 
  { latitude: 49.0, longitude: 14.0 }, 
];

const getGridCellId = (latitude: number, longitude: number) => {
  const x = Math.floor(longitude / GRID_SIZE);
  const y = Math.floor(latitude / GRID_SIZE);
  return `${x},${y}`;
};

const getCellBounds = (cellId: string) => {
  const [x, y] = cellId.split(',').map(Number);
  const minLon = x * GRID_SIZE;
  const minLat = y * GRID_SIZE;
  const maxLon = minLon + GRID_SIZE;
  const maxLat = minLat + GRID_SIZE;

  return [
    { latitude: minLat, longitude: minLon },
    { latitude: maxLat, longitude: minLon },
    { latitude: maxLat, longitude: maxLon },
    { latitude: minLat, longitude: maxLon },
  ];
};

// --------------------------------------------------
// GŁÓWNY KOMPONENT EKRANU
// --------------------------------------------------
export default function ExploreScreen() {
  const mapRef = useRef<MapView>(null);
  
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [visitedCells, setVisitedCells] = useState<string[]>([]);
  const [isDbReady, setIsDbReady] = useState(false);
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [hasCentered, setHasCentered] = useState(false);

  // 1. Inicjalizacja bazy i ładowanie odkrytych kwadratów
  useEffect(() => {
    const initDb = async () => {
      const database = await SQLite.openDatabaseAsync('krokomierz.db');
      setDb(database);
      
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS visited_cells (id TEXT PRIMARY KEY);
      `);

      const allRows = await database.getAllAsync<{ id: string }>('SELECT id FROM visited_cells');
      setVisitedCells(allRows.map(row => row.id));
      setIsDbReady(true);
    };
    initDb();
  }, []);

  // 2. Śledzenie GPS, zapisywanie kwadratów i centrowanie kamery
  useEffect(() => {
    if (!isDbReady || !db) return;

    let subscription: Location.LocationSubscription | null = null;

    const startWatching = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 5 },
          async (newLocation) => {
            const { latitude, longitude } = newLocation.coords;
            setLocation({ latitude, longitude });

            // Płynny najazd kamery przy pierwszym złapaniu pozycji
            if (!hasCentered && mapRef.current) {
              mapRef.current.animateToRegion({
                latitude: latitude,
                longitude: longitude,
                latitudeDelta: 0.005, // Przybliżenie domyślne
                longitudeDelta: 0.005,
              }, 1000);
              setHasCentered(true);
            }

            const currentCellId = getGridCellId(latitude, longitude);

            // Sprawdzanie i zapis nowego odkrytego obszaru
            if (!visitedCells.includes(currentCellId)) {
              setVisitedCells(prev => [...prev, currentCellId]);
              await db.runAsync('INSERT OR IGNORE INTO visited_cells (id) VALUES (?)', [currentCellId]);
            }
          }
        );
      } catch (error) {
        console.error("Błąd GPS:", error);
      }
    };

    startWatching();
    return () => { subscription?.remove(); };
  }, [isDbReady, db, visitedCells, hasCentered]);

  if (!isDbReady) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  const holes = visitedCells.map(getCellBounds);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType="none"
        // Domyślny punkt startowy zanim wczyta się GPS (np. Warszawa)
        initialRegion={{
          latitude: 52.2297,
          longitude: 21.0122,
          latitudeDelta: 5.0, // Startujemy z szerokim kątem, kamera sama zjedzie w dół
          longitudeDelta: 5.0,
        }}
        showsPointsOfInterest={false}
        showsBuildings={false}
        showsIndoors={false}
        showsTraffic={false}
      >
        <UrlTile 
          urlTemplate="https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png" 
          maximumZ={19} 
        />
        
        <Polygon 
          coordinates={MASK_BOUNDS} 
          holes={holes} 
          fillColor="rgba(0, 0, 0, 0.7)" 
          strokeWidth={0} 
        />
        
        {location && (
          <Marker coordinate={location} title="Tu jesteś" />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({ 
  container: { flex: 1 }, 
  map: { width: '100%', height: '100%' } 
});