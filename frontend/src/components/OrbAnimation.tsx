import React from "react";
import { useAppStore } from "../store/appStore";

type OrbState = "loading" | "ready" | "recording" | "error";

export function OrbAnimation() {
  const backendStatus = useAppStore((state) => state.backendStatus);
  const isRecording = useAppStore((state) => state.isRecording);
  const connectionState = useAppStore((state) => state.connectionState);

  const orbState: OrbState = React.useMemo(() => {
    if (backendStatus === "error" || backendStatus === "offline" || connectionState === "closed") {
      return "error";
    }
    if (isRecording) {
      return "recording";
    }
    if (backendStatus === "ready") {
      return "ready";
    }
    return "loading";
  }, [backendStatus, isRecording, connectionState]);

  return (
    <div className={`orb orb-${orbState}`}>
      {orbState === "error" && <span className="orb-label">!</span>}
      {orbState === "recording" && (
        <>
          <div className="orb-ripple" />
          <div className="orb-ripple" style={{ animationDelay: "0.5s" }} />
        </>
      )}
    </div>
  );
}
