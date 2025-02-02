"use client";

import { ScrollArea } from "@repo/ui/components/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@repo/ui/components/sheet";
import { TextShimmer } from "@repo/ui/components/text-shimmer";
import { cn } from "@repo/ui/lib/utils";
import { memo, useEffect, useRef, useState } from "react";

interface StreamingResponseProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  location?: string;
  imageClass?: string;
}

const ResponseHeader = memo(function ResponseHeader() {
  return (
    <TextShimmer className="font-mono text-lg font-semibold mb-4" duration={2}>
      Analyzing Image...
    </TextShimmer>
  );
});

export default function StreamingResponse({
  isOpen,
  onOpenChange,
  location,
  imageClass,
}: StreamingResponseProps) {
  const [response, setResponse] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setResponse([]);
      setError(null);
      setIsComplete(false);
      return;
    }

    if (!location || !imageClass) {
      return;
    }

    const timeoutId = setTimeout(() => {
      const eventSource = new EventSource(
        `http://localhost:5002/stream?location=${encodeURIComponent(location)}&imageClass=${encodeURIComponent(imageClass)}`
      );

      eventSource.onmessage = (event) => {
        const data = event.data;
        if (data === "[DONE]") {
          eventSource.close();
          setIsComplete(true);
        } else {
          setResponse((prev) => [...prev, data]);
        }
      };

      eventSource.onerror = (error) => {
        console.error("EventSource failed:", error);
        setError("Connection failed. Please try again.");
        eventSource.close();
      };

      return () => {
        eventSource.close();
      };
    }, 2000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isOpen, location, imageClass]);

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[80vh] sm:h-[70vh] p-6 max-w-screen-md mx-auto rounded-t-md">
        <div className="h-full flex flex-col">
          <SheetTitle>
            <ResponseHeader />
          </SheetTitle>

          <ScrollArea
            ref={scrollRef}
            className="flex-1 pr-4 font-mono text-sm leading-relaxed">
            {error ? (
              <div className="text-destructive">{error}</div>
            ) : (
              <div className="space-y-2">
                {response.map((chunk, i) => (
                  <span
                    key={i}
                    className={cn("inline animate-[fadeIn_0.5s_ease-in-out]")}>
                    {chunk}
                  </span>
                ))}
                {!isComplete && !response.length && (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-4 bg-emerald-400 rounded animate-[skeleton_2s_ease-in-out_infinite]"
                        style={{
                          animationDelay: `${i * 200}ms`,
                          width: "100%",
                          transformOrigin: "left",
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}
