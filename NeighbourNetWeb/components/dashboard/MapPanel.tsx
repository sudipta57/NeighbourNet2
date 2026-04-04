'use client';

import React from 'react';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Message, MeshStatus } from '../../lib/types';

const createPin = (tier: string, isSelected: boolean = false) => new L.DivIcon({
  className: '',
  html: `
    <div class="pin pin-${tier}">
      <div class="pin-head" style="${isSelected ? 'transform: scale(1.5); box-shadow: 0 0 20px white; border: 2px solid white; z-index: 1000;' : ''}"></div>
      <div class="pin-shadow"></div>
    </div>
  `,
  iconAnchor: [12, 36],
  popupAnchor: [0, -36]
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
  // Filter out messages without GPS coordinates — Leaflet requires valid numbers.
  const mappableMessages = messages.filter(
    (m) => m.gps_lat !== null && m.gps_lng !== null
  ) as (Message & { gps_lat: number; gps_lng: number })[];

  return (
    <div className="w-full h-full relative">
      
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

            {mappableMessages.map(m => {
              const isSelected = m.message_id === selectedMessageId;
              return (
              <Marker 
                key={m.message_id} 
                position={[m.gps_lat, m.gps_lng]} 
                icon={createPin(m.priority_tier, isSelected)}
                eventHandlers={{
                  mouseover: (e) => !isSelected && e.target.openPopup(),
                  mouseout: (e) => !isSelected && e.target.closePopup(),
                }}
                zIndexOffset={isSelected ? 1000 : 0}
              >
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
              </Marker>
            )})}
          </MapContainer>
        </div>
      </div>

    </div>
  );
}
