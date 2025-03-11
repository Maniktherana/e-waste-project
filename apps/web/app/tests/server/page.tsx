// app/server/page.tsx
"use client";

import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { useEffect, useRef, useState } from "react";

export default function Home() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startWebRTC = async () => {
    try {
      setIsLoading(true);
      setError(null);

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

      // Send offer to backend
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5005"}/offer`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sdp: pc.localDescription?.sdp,
            type: pc.localDescription?.type,
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
    }
  };

  const stopWebRTC = async () => {
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
        YOLO WebRTC Object Detection
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
            </div>
          </CardContent>
        </Card>
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
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4 max-w-md">
          <AlertDescription>Error: {error}</AlertDescription>
        </Alert>
      )}
    </main>
  );
}
