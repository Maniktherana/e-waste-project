"use client";

import { ScrollArea } from "@repo/ui/components/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@repo/ui/components/sheet";
import { TextShimmer } from "@repo/ui/components/text-shimmer";
import { cn } from "@repo/ui/lib/utils";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface StreamingResponseProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  location?: string;
  imageClass?: string;
  language?: string;
}

const ResponseHeader = memo(function ResponseHeader() {
  return (
    <TextShimmer className="font-mono text-lg font-semibold" duration={2}>
      Analyzing Detection...
    </TextShimmer>
  );
});

export default function StreamingResponse({
  isOpen,
  onOpenChange,
  location,
  imageClass,
  language = "English",
}: StreamingResponseProps) {
  const [response, setResponse] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [showClass, setShowClass] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Validation check for required props
  useEffect(() => {
    if (isOpen) {
      if (!location || !location.trim()) {
        setError("Please select a location to get disposal information");
        toast.error("Please select a location");
        onOpenChange(false);
        return;
      }

      if (!imageClass || !imageClass.trim()) {
        setError("No detection class selected");
        toast.error("No item detected");
        onOpenChange(false);
        return;
      }
    }
  }, [isOpen, location, imageClass, onOpenChange]);

  useEffect(() => {
    if (!isOpen) {
      setResponse([]);
      setError(null);
      setIsComplete(false);
      return;
    }

    setTimeout(() => {
      setShowClass(true);
    }, 1000);

    // Double-check that we have the required data
    if (!location || !imageClass) {
      return;
    }

    const timeoutId = setTimeout(() => {
      const eventSource = new EventSource(
        `http://localhost:5002/stream?location=${encodeURIComponent(location)}&imageClass=${encodeURIComponent(imageClass)}&language=${encodeURIComponent(language || "English")}`
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
        toast.error("Connection failed. Please try again.");
        eventSource.close();
      };

      return () => {
        eventSource.close();
      };
    }, 2000);

    return () => {
      clearTimeout(timeoutId);
      setShowClass(false);
    };
  }, [isOpen, location, imageClass, language]);

  // Auto-scroll to bottom of response
  useEffect(() => {
    if (scrollRef.current && response.length > 0) {
      const scrollElement = scrollRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [response]);

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[80vh] sm:h-[70vh] p-6 max-w-screen-md mx-auto rounded-t-md">
        <div className="h-full flex flex-col">
          <SheetTitle className="flex flex-col mr-5 mb-4">
            {isComplete ? (
              <p className="font-mono text-lg font-semibold">
                Analysis complete
              </p>
            ) : (
              <ResponseHeader />
            )}
            {showClass && (
              <p className="font-mono text-sm font-light text-muted-foreground animate-[fadeIn_0.2s_ease-in-out]">
                Detected Class:{" "}
                <span className="font-semibold">{imageClass}</span>
                {location && (
                  <>
                    {" "}
                    in <span className="font-semibold">{location}</span>
                  </>
                )}
              </p>
            )}
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
                    className={cn("inline animate-[fadeIn_0.5s_ease-in-out]")}
                    dangerouslySetInnerHTML={{ __html: chunk }}></span>
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
