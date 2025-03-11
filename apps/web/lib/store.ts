import { create } from "zustand";

export interface Detection {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
  class_id: number;
  class_name: string;
  image_width?: number;
  image_height?: number;
  timestamp: number;
}

interface DetectionState {
  detections: Detection[];
  selectedDetection: Detection | null;
  showDebug: boolean;
  addDetection: (detection: Omit<Detection, "id" | "timestamp">) => void;
  selectDetection: (id: string | null) => void;
  clearDetections: () => void;
  toggleDebug: () => void;
}

export const useDetectionStore = create<DetectionState>((set) => ({
  detections: [],
  selectedDetection: null,
  showDebug: false,
  addDetection: (detection) => {
    // Only add if this class_name doesn't already exist or if confidence is higher
    set((state) => {
      const id = `${detection.class_name}-${Date.now()}`;
      const existingIndex = state.detections.findIndex(
        (d) => d.class_name === detection.class_name
      );

      if (existingIndex >= 0) {
        // Only update if new detection has higher confidence
        if (detection.confidence > state.detections[existingIndex].confidence) {
          const updatedDetections = [...state.detections];
          updatedDetections[existingIndex] = {
            ...detection,
            id,
            timestamp: Date.now(),
          };
          return { detections: updatedDetections };
        }
        return state;
      }

      return {
        detections: [
          ...state.detections,
          {
            ...detection,
            id,
            timestamp: Date.now(),
          },
        ],
      };
    });
  },
  selectDetection: (id) => {
    set((state) => ({
      selectedDetection: id
        ? state.detections.find((d) => d.id === id) || null
        : null,
    }));
  },
  clearDetections: () => {
    set({ detections: [], selectedDetection: null });
  },
  toggleDebug: () => {
    set((state) => ({ showDebug: !state.showDebug }));
  },
}));
