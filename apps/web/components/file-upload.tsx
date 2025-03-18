"use client";

import { useDetectionStore } from "@/lib/store";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Label } from "@repo/ui/components/label";
import { Progress } from "@repo/ui/components/progress";
import { Slider } from "@repo/ui/components/slider";
import { Download, Loader2, Upload, X } from "lucide-react";
import Image from "next/image";
import { ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";

interface FileUploadProps {
  onError: (error: string | null) => void;
}

export default function FileUpload({ onError }: FileUploadProps) {
  const API_URL =
    window.location.hostname === "localhost" ? "http://localhost:5005" : "";

  const { addDetection } = useDetectionStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedFileId, setProcessedFileId] = useState<string | null>(null);
  const [detections, setDetections] = useState<any[]>([]);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.25);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (!file) return;
      setSelectedFile(file);

      const isVideoFile = file.type.startsWith("video/");
      setIsVideo(isVideoFile);

      const fileReader = new FileReader();
      fileReader.onload = () => {
        if (fileReader.result) {
          setFilePreview(fileReader.result as string);
        }
      };
      fileReader.readAsDataURL(file);

      setProcessedFileId(null);
      setDetections([]);
      onError(null);
    }
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
    setFilePreview(null);
    setProcessedFileId(null);
    setDetections([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Please select a file first");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    onError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("confidence", confidenceThreshold.toString());

      // Use XMLHttpRequest to track upload progress
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/upload`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(progress);
        }
      };

      xhr.onload = async () => {
        if (xhr.status === 200) {
          setIsUploading(false);
          setIsProcessing(true);

          try {
            const response = JSON.parse(xhr.responseText);

            if (response.detections && response.detections.length > 0) {
              response.detections.forEach((detection: any) => {
                addDetection({
                  x1: detection.x1,
                  y1: detection.y1,
                  x2: detection.x2,
                  y2: detection.y2,
                  confidence: detection.confidence,
                  class_id: detection.class_id || 0,
                  class_name: detection.class_name,
                  image_width: detection.image_width,
                  image_height: detection.image_height,
                });
              });

              setDetections(response.detections);

              toast.success(
                `${response.detections.length} objects detected in your ${
                  response.is_video ? "video" : "image"
                }`
              );
            } else {
              toast.info("No objects detected in the file");
            }

            // Store the file ID for downloading
            setProcessedFileId(response.file_id);
          } catch (parseError) {
            console.error("Error parsing response:", parseError);
            toast.error("Error processing response");
            onError("Error processing server response");
          }

          setIsProcessing(false);
        } else {
          setIsUploading(false);
          setIsProcessing(false);
          console.error("Upload failed:", xhr.statusText);

          try {
            const errorResponse = JSON.parse(xhr.responseText);
            toast.error(errorResponse.detail || "Upload failed");
            onError(errorResponse.detail || "Upload failed");
          } catch (e) {
            toast.error("Upload failed");
            onError(`Upload failed: ${xhr.statusText}`);
          }
        }
      };

      xhr.onerror = () => {
        setIsUploading(false);
        setIsProcessing(false);
        console.error("Upload error");
        toast.error("Connection error");
        onError("Connection error when uploading file");
      };

      xhr.send(formData);
    } catch (error) {
      setIsUploading(false);
      setIsProcessing(false);
      console.error("Error uploading file:", error);
      toast.error("Error uploading file");
      onError(
        error instanceof Error ? error.message : "Unknown error uploading file"
      );
    }
  };

  const handleDownload = () => {
    if (!processedFileId) return;

    // Create a download link and click it
    const downloadUrl = `${API_URL}/download/${processedFileId}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "processed_file"; // Browser will determine extension from mime type
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl text-center">
          Upload Image or Video
        </CardTitle>
        <CardDescription className="text-center">
          Upload files for AI detection of e-waste items
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div
            className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
            onClick={() => fileInputRef.current?.click()}>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              accept="image/jpeg,image/png,image/bmp,video/mp4,video/avi,video/mov,video/quicktime"
            />

            {!filePreview ? (
              <div className="py-8">
                <Upload className="mx-auto h-10 w-10 text-gray-400 mb-2" />
                <p className="text-sm text-gray-500">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Images (JPG, PNG) or Videos (MP4, MOV, AVI)
                </p>
              </div>
            ) : (
              <div className="relative">
                {isVideo ? (
                  <video
                    src={filePreview}
                    className="mx-auto max-h-64 rounded-lg"
                    controls
                  />
                ) : (
                  <Image
                    src={filePreview}
                    alt="Preview"
                    width={300}
                    height={300}
                    className="mx-auto max-h-64 object-contain rounded-lg"
                    unoptimized
                  />
                )}
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8 rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearSelectedFile();
                  }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="confidence">
                Confidence Threshold: {(confidenceThreshold * 100).toFixed(0)}%
              </Label>
            </div>
            <Slider
              id="confidence"
              min={0.1}
              max={0.9}
              step={0.05}
              value={[confidenceThreshold]}
              onValueChange={(value) => {
                if (value[0] !== undefined) {
                  setConfidenceThreshold(value[0]);
                }
              }}
              disabled={isUploading || isProcessing}
            />
          </div>

          <Button
            onClick={handleUpload}
            className="w-full"
            disabled={!selectedFile || isUploading || isProcessing}>
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading... {uploadProgress}%
              </>
            ) : isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Process File"
            )}
          </Button>

          {isUploading && <Progress value={uploadProgress} className="h-2" />}

          {processedFileId && (
            <div className="mt-6 space-y-4">
              <h3 className="font-semibold text-lg">Processed Result</h3>

              <Button
                onClick={handleDownload}
                variant="outline"
                className="w-full">
                <Download className="mr-2 h-4 w-4" />
                Download Processed {isVideo ? "Video" : "Image"}
              </Button>

              <div className="mt-4">
                <h4 className="font-medium mb-2">Detected Items:</h4>
                <div className="flex flex-wrap gap-2">
                  {detections.length > 0 ? (
                    detections.map((detection, index) => (
                      <Badge key={index} variant="outline">
                        {detection.class_name} (
                        {(detection.confidence * 100).toFixed(0)}%)
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">No items detected</p>
                  )}
                </div>
              </div>

              {isVideo && (
                <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-center">
                  <p className="text-sm">
                    Video processing complete! The video may be too large to
                    preview directly in the browser. Please use the download
                    button above to save and view the processed video.
                  </p>
                </div>
              )}

              {!isVideo && processedFileId && (
                <div className="mt-4">
                  <img
                    src={`${API_URL}/download/${processedFileId}`}
                    alt="Processed Image"
                    className="w-full rounded-lg border"
                    onError={() => {
                      onError(
                        "Error loading processed image. Please use the download button."
                      );
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
