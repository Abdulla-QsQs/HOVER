import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type MobileRuntimePlatform = "ios" | "android";

type MobileRuntimeMode = {
  native: boolean;
  platform: MobileRuntimePlatform;
};

const RuntimeModeContext = createContext<MobileRuntimeMode | null>(null);

function detectedPlatform(): MobileRuntimePlatform {
  const requested = new URLSearchParams(window.location.search).get("platform");
  if (requested === "android" || requested === "ios") return requested;
  return /android/i.test(navigator.userAgent) ? "android" : "ios";
}

function detectedNativeRuntime() {
  const requested = new URLSearchParams(window.location.search).get("runtime");
  if (requested === "native") return true;
  if (requested === "preview") return false;

  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    iosNavigator.standalone === true;
  const mobileAgent = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  const touchTablet =
    navigator.maxTouchPoints > 1 &&
    window.matchMedia("(pointer: coarse)").matches &&
    window.innerWidth <= 1180;

  return installed || mobileAgent || touchTablet;
}

export function MobileRuntimeModeProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<MobileRuntimeMode>(() => ({
    native: detectedNativeRuntime(),
    platform: detectedPlatform(),
  }));

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const update = () => setMode({ native: detectedNativeRuntime(), platform: detectedPlatform() });

    displayMode.addEventListener("change", update);
    coarsePointer.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("appinstalled", update);

    return () => {
      displayMode.removeEventListener("change", update);
      coarsePointer.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("appinstalled", update);
    };
  }, []);

  const value = useMemo(() => mode, [mode]);
  return <RuntimeModeContext.Provider value={value}>{children}</RuntimeModeContext.Provider>;
}

export function useMobileRuntimeMode() {
  const context = useContext(RuntimeModeContext);
  if (!context) throw new Error("useMobileRuntimeMode must be used inside MobileRuntimeModeProvider");
  return context;
}
