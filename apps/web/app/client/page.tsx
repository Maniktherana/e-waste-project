// app/client/page.tsx
//updated one claude only check this please
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
import { useEffect, useRef, useState } from "react";

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
  // Existing refs and state...
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const animationRef = useRef<number | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.25);
  const [boxColor, setBoxColor] = useState("#00FF00");

  // New debug state
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

  // Function to set up WebSocket connection for detection data
  const setupWebSocket = () => {
    // Use a more specific URL with 127.0.0.1 instead of localhost
    const wsUrl = `ws://127.0.0.1:5005/ws/detections`;
    console.log(
      `Attempting WebSocket connection to: ${wsUrl} at ${new Date().toISOString()}`
    );

    setDebugInfo((prev) => ({
      ...prev,
      wsStatus: `Connecting to ${wsUrl}...`,
    }));
    const ws = new WebSocket(wsUrl);

    // Add a timeout to detect connection issues
    const connectionTimeout = setTimeout(() => {
      if (ws.readyState !== 1) {
        // 1 = OPEN
        console.error("WebSocket connection timed out after 5 seconds");
        setError(
          "WebSocket connection timed out - server may not be reachable"
        );
        setDebugInfo((prev) => ({ ...prev, wsStatus: "Connection timeout" }));
      }
    }, 5000);

    ws.onopen = () => {
      console.log(`WebSocket connection OPENED at ${new Date().toISOString()}`);
      clearTimeout(connectionTimeout);
      setDebugInfo((prev) => ({ ...prev, wsStatus: "Connected ✓" }));
    };

    // In setupWebSocket function:
    // Update your WebSocket onmessage handler:
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        // Log the raw message occasionally
        if (Math.random() < 0.05) {
          console.log("Raw WebSocket message:", message);
        }

        // Update debug info with every message
        setDebugInfo((prev) => ({
          ...prev,
          lastMessageTime: Date.now(),
          messageCount: prev.messageCount + 1,
        }));

        if (message.type === "client_id") {
          console.log(`Received client_id: ${message.client_id}`);
          setClientId(message.client_id);
        } else if (message.type === "detections") {
          // Update the detections count in debug info
          setDebugInfo((prev) => ({
            ...prev,
            detectionCount: message.data.length,
          }));

          // IMPORTANT: Always update detections, even if empty
          // Make sure we're creating a new array to trigger React state updates
          setDetections([...message.data]);

          if (message.data.length > 0) {
            // Log detailed information about the first detection
            const firstDetection = message.data[0];
            console.log(
              `Received ${message.data.length} detections. First: ${firstDetection.class_name} (${firstDetection.confidence.toFixed(2)}) at [${firstDetection.x1.toFixed(0)},${firstDetection.y1.toFixed(0)}]`
            );
          }
        }
      } catch (err) {
        console.error("Error processing WebSocket message:", err);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      // Inspect the error object in detail
      console.dir(error, { depth: null });
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

  // Function to clean up WebSocket
  const cleanupWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const drawBoundingBoxes = () => {
    const canvas = canvasRef.current;
    const video = remoteVideoRef.current;

    if (!canvas || !video || !video.videoWidth) {
      console.log("Canvas or video not ready yet");
      // Schedule next frame even if not ready yet
      animationRef.current = requestAnimationFrame(drawBoundingBoxes);
      return;
    }

    // Set canvas size to match video dimensions exactly
    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      console.log(
        `Canvas resized to match video: ${canvas.width}x${canvas.height}`
      );

      // Update debug info when canvas is resized
      setDebugInfo((prev) => ({
        ...prev,
        canvasSize: { width: canvas.width, height: canvas.height },
      }));
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      animationRef.current = requestAnimationFrame(drawBoundingBoxes);
      return;
    }

    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Log all detections periodically to debug
    if (Math.random() < 0.01) {
      // Log about 1% of frames
      console.log(`Current detections (${detections.length}):`, detections);
      console.log(`Canvas size: ${canvas.width}x${canvas.height}`);
    }

    // Draw detections that meet confidence threshold
    const filteredDetections = detections.filter(
      (d) => d.confidence >= confidenceThreshold
    );

    // If we have detections, log them
    if (filteredDetections.length > 0 && Math.random() < 0.1) {
      console.log(
        `Drawing ${filteredDetections.length} detections that passed threshold ${confidenceThreshold}`
      );
    }

    // Now draw all the bounding boxes
    filteredDetections.forEach((detection) => {
      try {
        // Calculate scaling based on the image dimensions from the detection
        // and the current canvas dimensions
        const scaleX = canvas.width / (detection.image_width || canvas.width);
        const scaleY =
          canvas.height / (detection.image_height || canvas.height);

        // Calculate scaled coordinates
        const x1 = detection.x1 * scaleX;
        const y1 = detection.y1 * scaleY;
        const width = (detection.x2 - detection.x1) * scaleX;
        const height = (detection.y2 - detection.y1) * scaleY;

        // For debugging - log the coordinates occasionally
        if (Math.random() < 0.05) {
          console.log(
            `Drawing detection: ${detection.class_name} (${detection.confidence.toFixed(2)})`
          );
          console.log(
            `Original: x1=${detection.x1}, y1=${detection.y1}, x2=${detection.x2}, y2=${detection.y2}`
          );
          console.log(
            `Scaled: x1=${x1}, y1=${y1}, width=${width}, height=${height}`
          );
          console.log(`Scale factors: ${scaleX}x${scaleY}`);
        }

        // Draw bounding box with the user-selected color
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

        // Background for text
        ctx.fillStyle = boxColor;
        ctx.fillRect(x1, labelY - 20, textMetrics.width + 10, 25);

        // Text
        ctx.fillStyle = "#000000";
        ctx.fillText(label, x1 + 5, labelY);
      } catch (err) {
        console.error("Error drawing detection:", err, detection);
      }
    });

    // Continue animation loop
    animationRef.current = requestAnimationFrame(drawBoundingBoxes);
  };

  // Rest of your existing functions (startWebRTC, stopWebRTC, etc.)...
  const startWebRTC = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // FIRST: Ensure WebSocket is connected before proceeding
      const wsPromise = new Promise((resolve, reject) => {
        const ws = setupWebSocket();

        // Set up a timeout for WebSocket connection
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
        console.log("WebSocket connected successfully, proceeding with WebRTC");
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
      // In your startWebRTC function:
      pc.ontrack = (event) => {
        console.log("Received remote track", event);
        if (remoteVideoRef.current && event.streams[0]) {
          console.log("Setting remote video source");
          remoteVideoRef.current.srcObject = event.streams[0];

          // Start drawing bounding boxes when video metadata is loaded
          remoteVideoRef.current.onloadedmetadata = () => {
            console.log("Remote video metadata loaded");

            // Initialize canvas immediately
            if (canvasRef.current && remoteVideoRef.current) {
              canvasRef.current.width = remoteVideoRef.current.videoWidth;
              canvasRef.current.height = remoteVideoRef.current.videoHeight;

              console.log(
                `Canvas initialized to ${canvasRef.current.width}x${canvasRef.current.height}`
              );

              // Update debug info
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
                console.log("Remote video playback started successfully");

                // Stop any existing animation loop
                if (animationRef.current) {
                  cancelAnimationFrame(animationRef.current);
                }

                // Start the animation loop
                console.log("Starting drawing loop");
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

      // Send offer to backend
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
            client_id: clientId, // Make sure this is set
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

  const stopWebRTC = async () => {
    // Stop animation loop
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    // Close WebSocket connection
    cleanupWebSocket();

    // Close WebRTC connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Stop all tracks in local video
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      const stream = localVideoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      localVideoRef.current.srcObject = null;
    }

    // Clear remote video
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    // Clear canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }

    setDetections([]);
    setClientId(null);
    setIsConnected(false);
  };

  // Add a debug update interval
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
    }, 2000);

    return () => clearInterval(debugInterval);
  }, []);

  useEffect(() => {
    return () => {
      stopWebRTC();
    };
  }, []);

  // Add this effect to ensure the animation loop starts and stays running
  useEffect(() => {
    // This effect starts the animation loop when we have a video feed
    // and detections are being received
    if (
      isConnected &&
      remoteVideoRef.current &&
      remoteVideoRef.current.videoWidth > 0
    ) {
      console.log(
        "Starting or restarting animation loop due to connection status change"
      );

      // Cancel any existing animation frame
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      // Start a new animation loop
      animationRef.current = requestAnimationFrame(drawBoundingBoxes);

      // Initialize canvas if needed
      if (canvasRef.current) {
        canvasRef.current.width = remoteVideoRef.current.videoWidth;
        canvasRef.current.height = remoteVideoRef.current.videoHeight;
        console.log(
          `Canvas initialized in effect: ${canvasRef.current.width}x${canvasRef.current.height}`
        );
      }
    }

    return () => {
      // Clean up animation frame on unmount or when connection changes
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isConnected, drawBoundingBoxes]);

  // Add this effect to update debug info whenever detections change
  useEffect(() => {
    setDebugInfo((prev) => ({
      ...prev,
      detectionCount: detections.length,
    }));

    // Log when detections state changes
    console.log(`Detections state updated: ${detections.length} items`);
  }, [detections]);

  // Return your existing JSX but add a debug panel:
  return (
    <main className="flex flex-col items-center p-8 max-w-6xl mx-auto">
      {/* Existing UI components... */}
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
              {/* Canvas overlay for drawing bounding boxes */}
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
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
      {/* Add debug panel at the bottom */}
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
