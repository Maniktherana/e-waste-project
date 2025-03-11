// app/client/page.tsx
"use client";

import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { useCallback, useEffect, useRef, useState } from "react";

interface Detection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
  class_id: number;
  class_name: string;
  image_width: number;
  image_height: number;
}

export default function LocalDetectionPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const animationRef = useRef<number | null>(null);

  const detectionsRef = useRef<Detection[]>([]);

  const scaleFactorsRef = useRef({ x: 1, y: 1 });
  const frameCountRef = useRef(0);

  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.25);
  const [boxColor, setBoxColor] = useState("#00FF00");

  const [debugInfo, setDebugInfo] = useState<{
    wsStatus: string;
    lastMessageTime: number | null;
    messageCount: number;
    detectionCount: number;
    canvasSize: { width: number; height: number } | null;
    videoSize: { width: number; height: number } | null;
  }>({
    wsStatus: "Not connected",
    lastMessageTime: null,
    messageCount: 0,
    detectionCount: 0,
    canvasSize: null,
    videoSize: null,
  });

  const setupWebSocket = () => {
    const wsUrl = `ws://127.0.0.1:5005/localonly/ws/detections`;
    console.log(`Attempting WebSocket connection to: ${wsUrl}`);

    setDebugInfo((prev) => ({
      ...prev,
      wsStatus: `Connecting to ${wsUrl}...`,
    }));
    const ws = new WebSocket(wsUrl);

    const connectionTimeout = setTimeout(() => {
      if (ws.readyState !== 1) {
        console.error("WebSocket connection timed out after 5 seconds");
        setError(
          "WebSocket connection timed out - server may not be reachable"
        );
        setDebugInfo((prev) => ({ ...prev, wsStatus: "Connection timeout" }));
      }
    }, 5000);

    ws.onopen = () => {
      console.log("WebSocket connection opened");
      clearTimeout(connectionTimeout);
      setDebugInfo((prev) => ({ ...prev, wsStatus: "Connected ✓" }));

      startVideoCapture();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (frameCountRef.current % 10 === 0) {
          setDebugInfo((prev) => ({
            ...prev,
            lastMessageTime: Date.now(),
            messageCount: prev.messageCount + 1,
          }));
        }

        if (message.type === "client_id") {
          console.log(`Received client_id: ${message.client_id}`);
          setClientId(message.client_id);
        } else if (message.type === "detections") {
          detectionsRef.current = message.data;

          if (frameCountRef.current % 5 === 0) {
            setDetections(message.data);
            setDebugInfo((prev) => ({
              ...prev,
              detectionCount: message.data.length,
            }));
          }

          if (message.data.length > 0 && frameCountRef.current % 30 === 0) {
            const firstDetection = message.data[0];
            console.log(
              `Received ${message.data.length} detections. First: ${firstDetection.class_name} (${firstDetection.confidence.toFixed(2)})`
            );
          }
        }

        frameCountRef.current++;
      } catch (err) {
        console.error("Error processing WebSocket message:", err);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setError(
        `Failed to connect to detection stream: ${(error as ErrorEvent).message || "Unknown error"}`
      );
      setDebugInfo((prev) => ({
        ...prev,
        wsStatus: `Error: ${(error as ErrorEvent).message || "Unknown"}`,
      }));
    };

    ws.onclose = () => {
      console.log("WebSocket connection closed");
      setDebugInfo((prev) => ({ ...prev, wsStatus: "Closed" }));
    };

    wsRef.current = ws;
    return ws;
  };

  // Clean up WebSocket connection
  const cleanupWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  // Draw bounding boxes on canvas
  const drawBoundingBoxes = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !video || !video.videoWidth) {
      animationRef.current = requestAnimationFrame(drawBoundingBoxes);
      return;
    }

    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      setDebugInfo((prev) => ({
        ...prev,
        canvasSize: { width: canvas.width, height: canvas.height },
        videoSize: { width: video.videoWidth, height: video.videoHeight },
      }));
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      animationRef.current = requestAnimationFrame(drawBoundingBoxes);
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const currentDetections = detectionsRef.current;

    const filteredDetections = currentDetections.filter(
      (d) => d.confidence >= confidenceThreshold
    );

    // Draw bounding boxes
    if (filteredDetections.length > 0) {
      // Calculate scaling based on video and detection dimensions
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      filteredDetections.forEach((detection) => {
        try {
          const scaleX = videoWidth / (detection.image_width || videoWidth);
          const scaleY = videoHeight / (detection.image_height || videoHeight);

          const x1 = detection.x1 * scaleX;
          const y1 = detection.y1 * scaleY;
          const width = (detection.x2 - detection.x1) * scaleX;
          const height = (detection.y2 - detection.y1) * scaleY;

          ctx.strokeStyle = boxColor;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.rect(x1, y1, width, height);
          ctx.stroke();

          // Draw label with background
          const label = `${detection.class_name} ${(detection.confidence * 100).toFixed(0)}%`;
          ctx.font = "16px Arial";
          const textMetrics = ctx.measureText(label);
          const labelY = y1 > 25 ? y1 - 5 : y1 + 20;

          ctx.fillStyle = boxColor;
          ctx.fillRect(x1, labelY - 20, textMetrics.width + 10, 25);

          ctx.fillStyle = "#000000";
          ctx.fillText(label, x1 + 5, labelY);
        } catch (err) {
          console.error("Error drawing detection:", err);
        }
      });
    }

    // Continue animation loop
    animationRef.current = requestAnimationFrame(drawBoundingBoxes);
  }, [boxColor, confidenceThreshold]);

  // Capture local video and send frames to server for processing
  const startVideoCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        // Start drawing bounding boxes when video metadata is loaded
        videoRef.current.onloadedmetadata = () => {
          console.log("Video metadata loaded");

          if (canvasRef.current && videoRef.current) {
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;

            setDebugInfo((prev) => ({
              ...prev,
              canvasSize: {
                width: canvasRef.current.width,
                height: canvasRef.current.height,
              },
              videoSize: {
                width: videoRef.current.videoWidth,
                height: videoRef.current.videoHeight,
              },
            }));
          }

          videoRef.current
            .play()
            .then(() => {
              console.log("Video playback started");

              // Start animation loop for drawing bounding boxes
              if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
              }

              animationRef.current = requestAnimationFrame(drawBoundingBoxes);
              setIsConnected(true);
              setIsLoading(false);
            })
            .catch((err) => {
              console.error("Failed to play video:", err);
              setError("Failed to start video playback. Please try again.");
            });
        };

        const captureCanvas = document.createElement("canvas");
        const captureCtx = captureCanvas.getContext("2d");

        // Set up frame capture interval (adjust as needed for performance)
        const captureInterval = setInterval(() => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            return;
          }

          if (videoRef.current && captureCtx) {
            try {
              captureCanvas.width = videoRef.current.videoWidth;
              captureCanvas.height = videoRef.current.videoHeight;

              captureCtx.drawImage(
                videoRef.current,
                0,
                0,
                captureCanvas.width,
                captureCanvas.height
              );

              const frameDataUrl = captureCanvas.toDataURL("image/jpeg", 0.7);

              wsRef.current.send(
                JSON.stringify({
                  type: "video_frame",
                  client_id: clientId,
                  frame: frameDataUrl,
                  timestamp: Date.now(),
                })
              );
            } catch (err) {
              console.error("Error capturing frame:", err);
            }
          }
        }, 200); // Capture at ~5 fps for performance

        return () => {
          clearInterval(captureInterval);
        };
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      setError(
        "Could not access camera. Please check permissions and try again."
      );
      setIsLoading(false);
    }
  };

  const startDetection = async () => {
    try {
      setIsLoading(true);
      setError(null);

      setupWebSocket();
    } catch (err) {
      console.error("Error starting detection:", err);
      setError(
        err instanceof Error ? err.message : "An unknown error occurred"
      );
      setIsLoading(false);
      cleanupWebSocket();
    }
  };

  const stopDetection = async () => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    cleanupWebSocket();

    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }

    // Clear canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }

    detectionsRef.current = [];
    setDetections([]);
    setClientId(null);
    setIsConnected(false);
  };

  // Update debug info less frequently
  useEffect(() => {
    const debugInterval = setInterval(() => {
      if (videoRef.current) {
        setDebugInfo((prev) => ({
          ...prev,
          videoSize: {
            width: videoRef.current?.videoWidth || 0,
            height: videoRef.current?.videoHeight || 0,
          },
        }));
      }
    }, 5000);

    return () => clearInterval(debugInterval);
  }, []);

  useEffect(() => {
    return () => {
      stopDetection();
    };
  }, []);

  return (
    <main className="flex flex-col items-center p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-center">
        YOLO Local Video Detection
      </h1>

      <div className="w-full mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl text-center">
              Camera Feed with Detections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
                style={{ backgroundColor: "transparent" }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-sm">Confidence:</span>
          <Select
            value={confidenceThreshold.toString()}
            onValueChange={(val) => setConfidenceThreshold(parseFloat(val))}
            disabled={!isConnected}>
            <SelectTrigger className="w-24">
              <SelectValue placeholder="Confidence" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.1">10%</SelectItem>
              <SelectItem value="0.25">25%</SelectItem>
              <SelectItem value="0.5">50%</SelectItem>
              <SelectItem value="0.75">75%</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm">Box Color:</span>
          <input
            type="color"
            value={boxColor}
            onChange={(e) => setBoxColor(e.target.value)}
            className="w-10 h-10 rounded cursor-pointer"
            disabled={!isConnected}
          />
        </div>
      </div>

      <div className="flex gap-4 mt-4">
        {!isConnected ? (
          <Button
            onClick={startDetection}
            disabled={isLoading}
            className="text-base">
            {isLoading ? "Connecting..." : "Start Detection"}
          </Button>
        ) : (
          <Button
            onClick={stopDetection}
            variant="destructive"
            className="text-base">
            Stop Detection
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4 max-w-md">
          <AlertDescription>Error: {error}</AlertDescription>
        </Alert>
      )}

      <Card className="w-full mt-8">
        <CardHeader>
          <CardTitle>Debug Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <h3 className="font-semibold">WebSocket</h3>
              <p>Status: {debugInfo.wsStatus}</p>
              <p>Client ID: {clientId || "None"}</p>
              <p>Messages: {debugInfo.messageCount}</p>
              <p>
                Last message:{" "}
                {debugInfo.lastMessageTime
                  ? new Date(debugInfo.lastMessageTime).toLocaleTimeString()
                  : "None"}
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Detections</h3>
              <p>Current count: {debugInfo.detectionCount}</p>
              <p>
                Filtered count:{" "}
                {
                  detections.filter((d) => d.confidence >= confidenceThreshold)
                    .length
                }
              </p>
              <p>Confidence threshold: {confidenceThreshold}</p>
            </div>
            <div>
              <h3 className="font-semibold">Video/Canvas</h3>
              <p>
                Video size:{" "}
                {debugInfo.videoSize
                  ? `${debugInfo.videoSize.width}x${debugInfo.videoSize.height}`
                  : "Unknown"}
              </p>
              <p>
                Canvas size:{" "}
                {debugInfo.canvasSize
                  ? `${debugInfo.canvasSize.width}x${debugInfo.canvasSize.height}`
                  : "Unknown"}
              </p>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <div className="w-full">
            <h3 className="font-semibold mb-2">Latest Detections</h3>
            <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded text-xs overflow-auto max-h-32">
              {detections.length > 0 ? (
                <pre>{JSON.stringify(detections, null, 2)}</pre>
              ) : (
                <p>No detections yet</p>
              )}
            </div>
          </div>
        </CardFooter>
      </Card>
    </main>
  );
}
