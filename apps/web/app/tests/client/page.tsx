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

export default function ClientDrawingPage() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const animationRef = useRef<number | null>(null);

  // Store detections in a ref to avoid re-renders
  const detectionsRef = useRef<Detection[]>([]);

  // Store canvas drawing state in refs
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

  // Set up WebSocket connection for detection data
  const setupWebSocket = () => {
    const wsUrl = `ws://127.0.0.1:5005/ws/detections`;
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
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        // Update debug info less frequently
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
          // Store in ref for immediate access
          detectionsRef.current = message.data;

          // Update state less frequently
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
        `Failed to connect to detection stream: ${error.message || "Unknown error"}`
      );
      setDebugInfo((prev) => ({
        ...prev,
        wsStatus: `Error: ${error.message || "Unknown"}`,
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

  // Draw bounding boxes on canvas based on detections
  const drawBoundingBoxes = useCallback(() => {
    const canvas = canvasRef.current;
    const video = remoteVideoRef.current;

    if (!canvas || !video || !video.videoWidth) {
      animationRef.current = requestAnimationFrame(drawBoundingBoxes);
      return;
    }

    // Only resize canvas when dimensions change
    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Calculate and cache scale factors
      if (detectionsRef.current.length > 0) {
        const detection = detectionsRef.current[0];
        scaleFactorsRef.current = {
          x: canvas.width / (detection.image_width || canvas.width),
          y: canvas.height / (detection.image_height || canvas.height),
        };
      }

      // Update debug info when canvas is resized
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

    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Use data from ref for latest detections
    const currentDetections = detectionsRef.current;

    // Filter detections based on confidence threshold
    const filteredDetections = currentDetections.filter(
      (d) => d.confidence >= confidenceThreshold
    );

    // Draw bounding boxes
    if (filteredDetections.length > 0) {
      const { x: scaleX, y: scaleY } = scaleFactorsRef.current;

      filteredDetections.forEach((detection) => {
        try {
          // Pre-calculate coordinates
          const x1 = detection.x1 * scaleX;
          const y1 = detection.y1 * scaleY;
          const width = (detection.x2 - detection.x1) * scaleX;
          const height = (detection.y2 - detection.y1) * scaleY;

          // Draw bounding box
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

  // Start WebRTC connection and video streaming
  const startWebRTC = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Connect WebSocket first
      const wsPromise = new Promise((resolve, reject) => {
        const ws = setupWebSocket();

        const wsTimeout = setTimeout(() => {
          reject(new Error("WebSocket connection timed out"));
        }, 5000);

        ws.onopen = () => {
          clearTimeout(wsTimeout);
          resolve(ws);
        };

        ws.onerror = (err) => {
          clearTimeout(wsTimeout);
          reject(new Error("WebSocket connection failed"));
        };
      });

      try {
        await wsPromise;
        console.log("WebSocket connected, proceeding with WebRTC");
      } catch (wsError) {
        console.error("Failed to establish WebSocket connection:", wsError);
        setError("Could not connect to detection stream. Please try again.");
        setIsLoading(false);
        return;
      }

      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      // Display local video
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Add tracks to peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Set up remote video
      pc.ontrack = (event) => {
        console.log("Received remote track");
        if (remoteVideoRef.current && event.streams[0]) {
          console.log("Setting remote video source");
          remoteVideoRef.current.srcObject = event.streams[0];

          remoteVideoRef.current.onloadedmetadata = () => {
            console.log("Remote video metadata loaded");

            // Initialize canvas
            if (canvasRef.current && remoteVideoRef.current) {
              canvasRef.current.width = remoteVideoRef.current.videoWidth;
              canvasRef.current.height = remoteVideoRef.current.videoHeight;

              setDebugInfo((prev) => ({
                ...prev,
                canvasSize: {
                  width: canvasRef.current.width,
                  height: canvasRef.current.height,
                },
                videoSize: {
                  width: remoteVideoRef.current.videoWidth,
                  height: remoteVideoRef.current.videoHeight,
                },
              }));
            }

            // Play the video
            remoteVideoRef.current
              .play()
              .then(() => {
                console.log("Remote video playback started");

                if (animationRef.current) {
                  cancelAnimationFrame(animationRef.current);
                }

                animationRef.current = requestAnimationFrame(drawBoundingBoxes);
              })
              .catch((err) => {
                console.error("Failed to play remote video:", err);
                setError("Failed to start video playback. Please try again.");
              });
          };
        }
      };

      // Connection state changes
      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
        if (pc.connectionState === "connected") {
          setIsConnected(true);
          setIsLoading(false);
        } else if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          setIsConnected(false);
        }
      };

      // Create offer
      const offer = await pc.createOffer({
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);

      // Wait for client ID from WebSocket before sending offer
      let retries = 0;
      while (!clientId && retries < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        retries++;
      }

      console.log(`Sending offer with client_id: ${clientId}`);
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5005"}/client-drawing-offer`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sdp: pc.localDescription?.sdp,
            type: pc.localDescription?.type,
            client_id: clientId,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      // Process answer from backend
      const answer = await response.json();
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error("Error starting WebRTC:", err);
      setError(
        err instanceof Error ? err.message : "An unknown error occurred"
      );
      setIsLoading(false);
      cleanupWebSocket();
    }
  };

  // Stop WebRTC connection and clean up resources
  const stopWebRTC = async () => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    cleanupWebSocket();

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localVideoRef.current && localVideoRef.current.srcObject) {
      const stream = localVideoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      localVideoRef.current.srcObject = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

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
      if (remoteVideoRef.current) {
        setDebugInfo((prev) => ({
          ...prev,
          videoSize: {
            width: remoteVideoRef.current?.videoWidth || 0,
            height: remoteVideoRef.current?.videoHeight || 0,
          },
        }));
      }
    }, 5000); // Reduced frequency from 2000ms to 5000ms

    return () => clearInterval(debugInterval);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopWebRTC();
    };
  }, []);

  // Ensure animation loop starts and stays running when connection status changes
  useEffect(() => {
    if (
      isConnected &&
      remoteVideoRef.current &&
      remoteVideoRef.current.videoWidth > 0
    ) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      // Start the animation loop with the memoized function
      animationRef.current = requestAnimationFrame(drawBoundingBoxes);

      if (canvasRef.current) {
        canvasRef.current.width = remoteVideoRef.current.videoWidth;
        canvasRef.current.height = remoteVideoRef.current.videoHeight;
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isConnected, drawBoundingBoxes]);

  return (
    <main className="flex flex-col items-center p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-center">
        YOLO WebRTC - Client-Side Drawing
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl text-center">Local Feed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl text-center">
              Detection Feed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
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
            onClick={startWebRTC}
            disabled={isLoading}
            className="text-base">
            {isLoading ? "Connecting..." : "Start Detection"}
          </Button>
        ) : (
          <Button
            onClick={stopWebRTC}
            variant="destructive"
            className="text-base">
            Stop Detection
          </Button>
        )}
        <Button variant="outline" onClick={() => (window.location.href = "/")}>
          Switch to Server Drawing
        </Button>
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
