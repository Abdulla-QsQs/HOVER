import { useEffect, type PropsWithChildren } from "react";
import { MobileDeviceProvider, useMobileDevice } from "./Device";
import { KeyboardDock, KeyboardProvider, useKeyboard } from "./Keyboard";
import { PhoneFrame } from "./PhoneFrame";
import { HomeIndicator, StatusBar } from "./components";
import { MobileRuntimeModeProvider, useMobileRuntimeMode } from "./RuntimeMode";

export function MobileRuntime({ children }: PropsWithChildren) {
  return (
    <MobileRuntimeModeProvider>
      <RuntimeSurface>{children}</RuntimeSurface>
    </MobileRuntimeModeProvider>
  );
}

function RuntimeSurface({ children }: PropsWithChildren) {
  const runtime = useMobileRuntimeMode();

  return (
    <MobileDeviceProvider initialDeviceId={runtime.platform === "android" ? "pixel-10" : "iphone"}>
      <PhoneFrame native={runtime.native}>
        <KeyboardProvider native={runtime.native}>
          {!runtime.native ? <KeyboardPreview /> : null}
          {!runtime.native ? <StatusBar /> : null}
          <MobileAppViewport>{children}</MobileAppViewport>
          {!runtime.native ? <HomeIndicator /> : null}
          {!runtime.native ? <KeyboardDock /> : null}
        </KeyboardProvider>
      </PhoneFrame>
    </MobileDeviceProvider>
  );
}

function MobileAppViewport({ children }: PropsWithChildren) {
  const { device } = useMobileDevice();
  const keyboard = useKeyboard();
  const runtime = useMobileRuntimeMode();

  return (
    <div
      className="mobile-app-viewport"
      data-keyboard-visible={keyboard.visible ? "true" : "false"}
      data-native-runtime={runtime.native ? "true" : "false"}
      data-platform={device.platform}
      data-testid="mobile-app-viewport"
    >
      {children}
    </div>
  );
}

function KeyboardPreview() {
  const keyboard = useKeyboard();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("keyboard") === "1") {
      keyboard.show();
    }
  }, [keyboard]);

  return null;
}
