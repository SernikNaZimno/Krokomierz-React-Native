import React, { useState, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polygon, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';

// --------------------------------------------------
// LOGIKA SIATKI I MGŁY WOJNY
// --------------------------------------------------
const GRID_SIZE = 0.0005; // Rozmiar kwadratu (~50m)

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
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [visitedCells, setVisitedCells] = useState<string[]>([]);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;

    const startWatching = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 5 },
          (newLocation) => {
            const { latitude, longitude } = newLocation.coords;
            setLocation({ latitude, longitude });

            const currentCellId = getGridCellId(latitude, longitude);

            setVisitedCells((prev) => {
              if (!prev.includes(currentCellId)) {
                return [...prev, currentCellId];
              }
              return prev;
            });
          }
        );
      } catch (error) {
        console.error("Błąd GPS:", error);
      }
    };

    startWatching();
    return () => { subscription?.remove(); };
  }, []);

  const holes = visitedCells.map(getCellBounds);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        mapType="none"
        showsPointsOfInterest={false}
        showsBuildings={false}
        showsIndoors={false}
        showsTraffic={false}
        // Przybliżamy startowo na centrum Polski
        initialRegion={{
          latitude: 52.0,
          longitude: 19.0,
          latitudeDelta: 5.0,
          longitudeDelta: 5.0,
        }}
      >
        <UrlTile
          urlTemplate="https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
          maximumZ={19}
        />

        {/* Ciemna nakładka z dziurami na odwiedzone lokacje */}
        <Polygon
          coordinates={MASK_BOUNDS}
          holes={holes}
          fillColor="rgba(0, 0, 0, 0.7)"
          strokeWidth={0}
        />

        {location && (
          <Marker
            coordinate={{
              latitude: location.latitude,
              longitude: location.longitude,
            }}
            title="Tu jesteś"
          />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: '100%', height: '100%' },
});