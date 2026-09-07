export interface LatLng { getLat(): number; getLng(): number; }

export interface KakaoMapInstance { 
  setCenter(latlng: LatLng): void; 
  panTo(latlng: LatLng): void; 
  relayout(): void; 
}

// Kakao Polygon에서 사용하는 최소 메서드 정의
export interface KakaoPolygon {
  setMap(map: KakaoMapInstance | null): void;
  setOptions(options: any): void;
}

export interface KakaoMaps {
  LatLng: new (lat: number, lng: number) => LatLng;
  Map: new (container: HTMLElement, options: any) => KakaoMapInstance;
  Marker: new (options: any) => any;
  MarkerImage: new (src: string, size: any) => any;
  Size: new (w: number, h: number) => any;
  Circle: new (options: any) => any;
  Polyline: new (options: any) => { getLength(): number };
  InfoWindow: new (options: any) => any;
  CustomOverlay: new (options: any) => any;
  Polygon: new (options: any) => KakaoPolygon;
  load: (callback: () => void) => void;
  event: { addListener(target: any, type: string, callback: (mouseEvent?: any) => void): void; };
  services: { Geocoder: new () => any; Status: { OK: string }; };
}
declare global { interface Window { kakao: { maps: KakaoMaps }; } }

export interface Market {
  store_name: string;
  category_small_name: string;
  address_road: string;
  lat: number;
  lon: number;
  distance: number;
}
export interface LandPrice { pnu: string; jiga: number; address: string; lat: number; lng: number; }
export interface Trade { dealAmount: string; dealDay: string; dealYear: number; dealMonth: number; floor: number; jibun: string; lat: number; lng: number; }