"use client";

import { useDetectionStore } from "@/lib/store";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Switch } from "@repo/ui/components/switch";
import { useCallback, useEffect, useRef, useState } from "react";

interface VideoStreamProps {
  onError: (error: string | null) => void;
}

export default function VideoStream({ onError }: VideoStreamProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const animationRef = useRef<number | null>(null);
  const detectionsRef = useRef<any[]>([]);
  const frameCountRef = useRef(0);

  const { addDetection, showDebug, toggleDebug } = useDetectionStore();

  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.25);
  const [boxColor, setBoxColor] = useState("#00FF00");
  const [localDetections, setLocalDetections] = useState<any[]>([]);

  const [debugInfo, setDebugInfo] = useState({
    wsStatus: "Not connected",
    lastMessageTime: null as number | null,
    messageCount: 0,
    detectionCount: 0,
    canvasSize: null as { width: number; height: number } | null,
    videoSize: null as { width: number; height: number } | null,
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
        onError("WebSocket connection timed out - server may not be reachable");
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
            setLocalDetections(message.data);
            setDebugInfo((prev) => ({
              ...prev,
              detectionCount: message.data.length,
            }));
          }

          // Process detections and add to store if confidence is high enough
          if (message.data.length > 0) {
            const seenClasses = new Set();

            message.data.forEach((detection: any) => {
              if (
                detection.confidence >= confidenceThreshold &&
                !seenClasses.has(detection.class_name)
              ) {
                seenClasses.add(detection.class_name);
                addDetection(detection);
              }
            });
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
      onError(
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

  const cleanupWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

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

    if (filteredDetections.length > 0) {
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

    animationRef.current = requestAnimationFrame(drawBoundingBoxes);
  }, [boxColor, confidenceThreshold]);

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

              if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
              }

              animationRef.current = requestAnimationFrame(drawBoundingBoxes);
              setIsConnected(true);
              setIsLoading(false);
            })
            .catch((err) => {
              console.error("Failed to play video:", err);
              onError("Failed to start video playback. Please try again.");
            });
        };

        const captureCanvas = document.createElement("canvas");
        const captureCtx = captureCanvas.getContext("2d");

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
      onError(
        "Could not access camera. Please check permissions and try again."
      );
      setIsLoading(false);
    }
  };

  const startDetection = async () => {
    try {
      setIsLoading(true);
      onError(null);

      setupWebSocket();
    } catch (err) {
      console.error("Error starting detection:", err);
      onError(err instanceof Error ? err.message : "An unknown error occurred");
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

    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }

    detectionsRef.current = [];
    setLocalDetections([]);
    setClientId(null);
    setIsConnected(false);
  };

  useEffect(() => {
    return () => {
      stopDetection();
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl text-center">
          Camera Feed with Detections
        </CardTitle>
        <CardDescription className="text-center">
          Analyze e-waste in real-time with AI detection
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative rounded-lg overflow-hidden bg-black aspect-video mb-4">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
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

          <div className="flex items-center space-x-2">
            <Switch
              id="debug-mode"
              checked={showDebug}
              onCheckedChange={toggleDebug}
            />
            <Label htmlFor="debug-mode">Debug Mode</Label>
          </div>
        </div>

        <div className="flex justify-center">
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
      </CardContent>

      {showDebug && (
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
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
                  localDetections.filter(
                    (d) => d.confidence >= confidenceThreshold
                  ).length
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

          <div className="w-full">
            <h3 className="font-semibold mb-2">Latest Detections</h3>
            <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded text-xs overflow-auto max-h-32">
              {localDetections.length > 0 ? (
                <pre>{JSON.stringify(localDetections, null, 2)}</pre>
              ) : (
                <p>No detections yet</p>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
