"use client";

import FileUpload from "@/components/file-upload";
import ResponseSettings from "@/components/response-settings";
import StreamingResponse from "@/components/streaming-response";
import VideoStream from "@/components/video-stream";
import { useDetectionStore } from "@/lib/store";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import { useEffect, useState } from "react";

export default function DetectionStreamingPage() {
  const { selectedDetection, selectDetection } = useDetectionStore();
  const [error, setError] = useState<string | null>(null);
  const [showResponse, setShowResponse] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [selectedLang, setSelectedLang] = useState<string>("English");
  const [activeTab, setActiveTab] = useState<string>("live");

  const handleError = (errorMsg: string | null) => {
    setError(errorMsg);
  };

  const handleShowResponse = (show: boolean) => {
    setShowResponse(show);
  };

  const handleStreamingClose = () => {
    setShowResponse(false);
    selectDetection(null);
  };

  const handleSettingsChange = (city: string, lang: string) => {
    setSelectedCity(city);
    setSelectedLang(lang);
  };

  useEffect(() => {
    // Close response when selection is cleared
    if (!selectedDetection && showResponse) {
      setShowResponse(false);
    }
  }, [selectedDetection, showResponse]);

  // Load previous settings from localStorage if available
  useEffect(() => {
    const savedCity = localStorage.getItem("selectedCity");
    const savedLang = localStorage.getItem("selectedLang");
    const savedTab = localStorage.getItem("activeTab");

    if (savedCity) setSelectedCity(savedCity);
    if (savedLang) setSelectedLang(savedLang);
    if (savedTab === "live" || savedTab === "upload") setActiveTab(savedTab);
  }, []);

  // Save active tab to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("activeTab", activeTab);
  }, [activeTab]);

  return (
    <main className="flex flex-col items-center p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-center">
        E-waste Detection & Analysis
      </h1>

      <div className="w-full mb-6">
        <ResponseSettings
          onShowResponse={handleShowResponse}
          onSettingsChange={handleSettingsChange}
        />
      </div>

      <Tabs
        defaultValue={activeTab}
        className="w-full"
        onValueChange={(value: any) => setActiveTab(value as string)}>
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="live">Live Camera</TabsTrigger>
          <TabsTrigger value="upload">Upload File</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="w-full">
          <VideoStream onError={handleError} />
        </TabsContent>

        <TabsContent value="upload" className="w-full">
          <FileUpload onError={handleError} />
        </TabsContent>
      </Tabs>

      {error && (
        <Alert variant="destructive" className="mt-4 max-w-md">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <StreamingResponse
        isOpen={showResponse}
        onOpenChange={handleStreamingClose}
        location={selectedCity}
        imageClass={selectedDetection?.class_name || ""}
        language={selectedLang}
      />
    </main>
  );
}
