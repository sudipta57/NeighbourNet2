'use client';

import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap, Polyline, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Message, MeshStatus } from '../../lib/types';
import { Ruler, X } from 'lucide-react';

const createPin = (tier: string, isSelected: boolean = false) => new L.DivIcon({
  className: '',
  html: `
    <div class="pin pin-${tier}">
      <div class="pin-head" style="${isSelected ? 'transform: scale(1.5); box-shadow: 0 0 8px rgba(0,0,0,0.2); z-index: 1000;' : ''}"></div>
    </div>
  `,
  iconAnchor: [8, 16],
  popupAnchor: [0, -16]
});

interface Props {
  messages: Message[];
  meshStatus: MeshStatus;
  selectedMessageId?: string | null;
}

function MapController({ selectedMessageId, messages }: { selectedMessageId?: string | null, messages: (Message & { gps_lat: number; gps_lng: number })[] }) {
  const map = useMap();
  React.useEffect(() => {
    if (selectedMessageId) {
      const msg = messages.find(m => m.message_id === selectedMessageId);
      if (msg) {
        map.flyTo([msg.gps_lat, msg.gps_lng], 16, { animate: true, duration: 1.5 });
      }
    }
  }, [selectedMessageId, messages, map]);
  return null;
}

export default function MapPanel({ messages, meshStatus, selectedMessageId }: Props) {
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);

  const handleMarkerClick = (lat: number, lng: number) => {
    if (!isMeasuring) return;
    
    if (measurePoints.length >= 2) {
      setMeasurePoints([[lat, lng]]);
    } else {
      setMeasurePoints([...measurePoints, [lat, lng]]);
    }
  };

  const getDistanceInfo = () => {
    if (measurePoints.length !== 2) return null;
    const p1 = L.latLng(measurePoints[0][0], measurePoints[0][1]);
    const p2 = L.latLng(measurePoints[1][0], measurePoints[1][1]);
    const distanceM = p1.distanceTo(p2);
    return distanceM > 1000 
      ? `${(distanceM / 1000).toFixed(2)} km` 
      : `${Math.round(distanceM)} m`;
  };

  // Filter out messages without GPS coordinates — Leaflet requires valid numbers.
  const mappableMessages = messages.filter(
    (m) => m.gps_lat !== null && m.gps_lng !== null
  ) as (Message & { gps_lat: number; gps_lng: number })[];

  return (
    <div className="w-full h-full relative">
      
      {/* Floating Measure Button */}
      <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-2">
        <button
          onClick={() => {
            setIsMeasuring(!isMeasuring);
            setMeasurePoints([]);
          }}
          className={`flex items-center gap-2 px-3 py-2 rounded shadow-md transition-colors ${
            isMeasuring ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-white text-slate-700 hover:bg-gray-100'
          }`}
          title="Toggle Measure Distance"
        >
          {isMeasuring ? <X size={20} /> : <Ruler size={20} />}
          <span className="font-semibold text-sm">
            {isMeasuring ? 'Cancel Measurement' : 'Measure Distance'}
          </span>
        </button>
      </div>

      {isMeasuring && measurePoints.length === 1 && (
        <div className="absolute top-16 left-4 z-[1000] bg-blue-50 text-blue-800 text-sm px-3 py-2 rounded shadow-md font-medium border border-blue-200">
          Select second person
        </div>
      )}

      {isMeasuring && measurePoints.length === 0 && (
        <div className="absolute top-16 left-4 z-[1000] bg-blue-50 text-blue-800 text-sm px-3 py-2 rounded shadow-md font-medium border border-blue-200">
          Select first person
        </div>
      )}

      {!meshStatus.has_active_gateways && (
        <div className="gateway-warning-banner">
          ⚠ No gateways have synced in the last 5 minutes — mesh data may be stale
        </div>
      )}

      <div className="map-bezel">
        <div className="map-screen">
          <MapContainer 
            center={[22.5, 88.85]} 
            zoom={10} 
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
            />
            <ZoomControl position="topright" />
            
            <MapController selectedMessageId={selectedMessageId} messages={mappableMessages} />

            {measurePoints.length > 0 && (
              <Polyline positions={measurePoints} color="#2563eb" weight={4} dashArray="10, 10">
                {measurePoints.length === 2 && (
                  <Tooltip permanent direction="center" className="bg-white/90 backdrop-blur px-2 py-1 rounded shadow-sm text-sm font-bold border-0 text-blue-800">
                    {getDistanceInfo()}
                  </Tooltip>
                )}
              </Polyline>
            )}

            {mappableMessages.map(m => {
              const isSelected = m.message_id === selectedMessageId;
              const isMeasurePoint = isMeasuring && measurePoints.some(p => p[0] === m.gps_lat && p[1] === m.gps_lng);
              return (
              <Marker 
                key={m.message_id} 
                position={[m.gps_lat, m.gps_lng]} 
                icon={createPin(m.priority_tier, isSelected || isMeasurePoint)}
                eventHandlers={{
                  mouseover: (e) => {
                    if (!isSelected && !isMeasuring) e.target.openPopup();
                  },
                  mouseout: (e) => {
                    if (!isSelected && !isMeasuring) e.target.closePopup();
                  },
                  click: (e) => {
                    if (isMeasuring) {
                      handleMarkerClick(m.gps_lat, m.gps_lng);
                    }
                  }
                }}
                zIndexOffset={isSelected ? 1000 : (isMeasurePoint ? 500 : 0)}
              >
                {!isMeasuring ? (
                <Popup className="sticky-note-popup" closeButton={false}>
                  <div className="sticky-note-inner">
                    <span className={`popup-badge popup-badge--${m.priority_tier.toLowerCase()}`}>
                      {m.priority_tier}
                    </span>
                    <p className="popup-location">
                      {m.extracted_location || m.location_hint || `${m.gps_lat.toFixed(4)}, ${m.gps_lng.toFixed(4)}`}
                    </p>
                    <p className="popup-body">{m.body.slice(0, 100)}{m.body.length > 100 ? '…' : ''}</p>
                    <span className="popup-meta">{m.hop_count} hops · {new Date(m.created_at).toLocaleTimeString('en-US', { hour12: false })}</span>
                  </div>
                </Popup>
                ) : null}
              </Marker>
            )})}
          </MapContainer>
        </div>
      </div>

    </div>
  );
}
