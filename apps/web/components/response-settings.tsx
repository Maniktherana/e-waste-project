"use client";

import { LANGUAGES, LOCATIONS } from "@/lib/constants";
import { useDetectionStore } from "@/lib/store";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { useEffect, useState } from "react";
import { toast } from "sonner";

// Get unique cities
const uniqueCities = Array.from(
  new Set(LOCATIONS.map((loc) => loc.city))
).sort();

interface ResponseSettingsProps {
  onShowResponse: (show: boolean) => void;
  onSettingsChange: (city: string, language: string) => void;
}

export default function ResponseSettings({
  onShowResponse,
  onSettingsChange,
}: ResponseSettingsProps) {
  const {
    detections: storedDetections,
    selectedDetection,
    selectDetection,
    clearDetections,
  } = useDetectionStore();

  const [selectedCity, setSelectedCity] = useState<string>(() => {
    // Initialize from localStorage if available
    if (typeof window !== "undefined") {
      return localStorage.getItem("selectedCity") || "";
    }
    return "";
  });

  const [selectedLang, setSelectedLang] = useState<string>(() => {
    // Initialize from localStorage if available
    if (typeof window !== "undefined") {
      return localStorage.getItem("selectedLang") || "English";
    }
    return "English";
  });

  // Notify parent of settings changes
  useEffect(() => {
    // Store in local storage for persistence
    if (selectedCity) localStorage.setItem("selectedCity", selectedCity);
    localStorage.setItem("selectedLang", selectedLang);

    // Notify parent component
    onSettingsChange(selectedCity, selectedLang);
  }, [selectedCity, selectedLang, onSettingsChange]);

  useEffect(() => {
    // If selection changed, trigger response dialog but verify we have a city selected
    if (selectedDetection) {
      if (!selectedCity) {
        toast.error("Please select a city first");
        selectDetection(null);
        return;
      }
      onShowResponse(true);
    }
  }, [selectedDetection, onShowResponse, selectedCity, selectDetection]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Streaming Response Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4">
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Select value={selectedCity} onValueChange={setSelectedCity}>
              <SelectTrigger id="location">
                <SelectValue placeholder="Select a city" />
              </SelectTrigger>
              <SelectContent>
                {uniqueCities.map((city) => (
                  <SelectItem key={city} value={city}>
                    {city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="language">Language</Label>
            <Select value={selectedLang} onValueChange={setSelectedLang}>
              <SelectTrigger id="language">
                <SelectValue placeholder="English" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.id} value={lang.language}>
                    {lang.display}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col space-y-2 mt-4">
            <div className="flex items-center justify-between">
              <Label>Detected Items</Label>
              {storedDetections.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => clearDetections()}>
                  Clear
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {storedDetections.length > 0 ? (
                storedDetections.map((detection) => (
                  <Badge
                    key={detection.id}
                    variant={
                      selectedDetection?.id === detection.id
                        ? "default"
                        : "outline"
                    }
                    className="cursor-pointer hover:bg-primary/20"
                    onClick={() => {
                      if (!selectedCity) {
                        toast.error("Please select a city first");
                        return;
                      }
                      selectDetection(detection.id);
                    }}>
                    {detection.class_name} (
                    {(detection.confidence * 100).toFixed(0)}%)
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No items detected yet
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
