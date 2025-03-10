// app/client-drawing/page.tsx
"use client";

import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
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

  // Function to set up WebSocket connection for detection data
  const setupWebSocket = () => {
    const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000"}/ws/detections`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("WebSocket connection established");
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "client_id") {
        setClientId(message.client_id);
      } else if (message.type === "detections") {
        setDetections(message.data);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setError("Failed to connect to detection stream");
    };

    ws.onclose = () => {
      console.log("WebSocket connection closed");
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

  // Function to draw bounding boxes on canvas
  const drawBoundingBoxes = () => {
    const canvas = canvasRef.current;
    const video = remoteVideoRef.current;

    if (!canvas || !video || !video.videoWidth) {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear previous drawings
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw current detections that meet confidence threshold
    detections
      .filter((detection) => detection.confidence >= confidenceThreshold)
      .forEach((detection) => {
        // Calculate position scaling if needed
        const scaleX = canvas.width / (detection.image_width || canvas.width);
        const scaleY =
          canvas.height / (detection.image_height || canvas.height);

        // Draw bounding box
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(
          detection.x1 * scaleX,
          detection.y1 * scaleY,
          (detection.x2 - detection.x1) * scaleX,
          (detection.y2 - detection.y1) * scaleY
        );
        ctx.stroke();

        // Draw label
        const label = `${detection.class_name} ${(detection.confidence * 100).toFixed(1)}%`;
        ctx.fillStyle = boxColor;
        const textMetrics = ctx.measureText(label);
        const labelY =
          detection.y1 * scaleY > 25
            ? detection.y1 * scaleY - 5
            : detection.y1 * scaleY + 20;

        ctx.fillRect(
          detection.x1 * scaleX,
          labelY - 20,
          textMetrics.width + 10,
          25
        );

        ctx.fillStyle = "#000000";
        ctx.font = "16px Arial";
        ctx.fillText(label, detection.x1 * scaleX + 5, labelY);
      });

    // Continue animation loop
    animationRef.current = requestAnimationFrame(drawBoundingBoxes);
  };

  const startWebRTC = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Set up WebSocket connection
      const ws = setupWebSocket();

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
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];

          // Start drawing bounding boxes when video starts playing
          remoteVideoRef.current.onloadedmetadata = () => {
            remoteVideoRef.current?.play();
            animationRef.current = requestAnimationFrame(drawBoundingBoxes);
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

  useEffect(() => {
    return () => {
      stopWebRTC();
    };
  }, []);

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
              {/* Canvas overlay for drawing bounding boxes */}
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
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
    </main>
  );
}
