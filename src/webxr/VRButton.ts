/*
Copyright © 2010-2024 three.js authors & Mark Kellogg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
*/

// @ts-ignore
import * as THREE from "three";

// Define a simple WebXR session init interface
interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
  [key: string]: any;
}

// Create a simple XRSession interface that only defines the methods we use
interface BasicXRSession extends EventTarget {
  end(): Promise<void>;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

// Define WebGLRendererXR interface for the renderer.xr property
interface WebGLRendererXR {
  setSession(session: BasicXRSession): Promise<void>;
  enabled?: boolean;
  [key: string]: any;
}

export class VRButton {
  // Class property
  static xrSessionIsGranted: boolean = false;

  /**
   * Creates a button for entering and exiting VR
   * @param renderer The THREE.WebGLRenderer instance
   * @param sessionInit Optional XR session initialization options
   * @returns A DOM element (button or link) for VR control
   */
  static createButton(
    renderer: THREE.WebGLRenderer & {
      xr: WebGLRendererXR;
    },
    sessionInit: XRSessionInit = {}
  ): HTMLElement {
    const button = document.createElement("button");

    function showEnterVR(/* device */): void {
      let currentSession: any = null;

      async function onSessionStarted(session: any): Promise<void> {
        session.addEventListener("end", onSessionEnded);

        // @ts-ignore - WebGLRenderer.xr.setSession is not properly typed, but it exists
        await renderer.xr.setSession(session);
        button.textContent = "EXIT VR";

        currentSession = session;
      }

      function onSessionEnded(/* event */): void {
        if (currentSession) {
          currentSession.removeEventListener("end", onSessionEnded);
        }

        button.textContent = "ENTER VR";

        currentSession = null;
      }

      //

      button.style.display = "";

      button.style.cursor = "pointer";
      button.style.left = "calc(50% - 50px)";
      button.style.width = "100px";

      button.textContent = "ENTER VR";

      // WebXR's requestReferenceSpace only works if the corresponding feature
      // was requested at session creation time. For simplicity, just ask for
      // the interesting ones as optional features, but be aware that the
      // requestReferenceSpace call will fail if it turns out to be unavailable.
      // ('local' is always available for immersive sessions and doesn't need to
      // be requested separately.)

      const sessionOptions: XRSessionInit = {
        ...sessionInit,
        optionalFeatures: [
          "local-floor",
          "bounded-floor",
          "layers",
          ...(sessionInit.optionalFeatures || []),
        ],
      };

      button.onmouseenter = function (): void {
        button.style.opacity = "1.0";
      };

      button.onmouseleave = function (): void {
        button.style.opacity = "0.5";
      };

      button.onclick = function (): void {
        if (currentSession === null && navigator.xr) {
          navigator.xr
            .requestSession("immersive-vr", sessionOptions)
            .then(onSessionStarted);
        } else if (currentSession) {
          currentSession.end();

          // Check if offerSession exists as a function
          const xr = navigator.xr as any;
          if (xr && typeof xr.offerSession === "function") {
            xr.offerSession("immersive-vr", sessionOptions)
              .then(onSessionStarted)
              .catch((err: any) => {
                console.warn(err);
              });
          }
        }
      };

      // Check if offerSession exists as a function
      const xr = navigator.xr as any;
      if (xr && typeof xr.offerSession === "function") {
        xr.offerSession("immersive-vr", sessionOptions)
          .then(onSessionStarted)
          .catch((err: any) => {
            console.warn(err);
          });
      }
    }

    function disableButton(): void {
      button.style.display = "";

      button.style.cursor = "auto";
      button.style.left = "calc(50% - 75px)";
      button.style.width = "150px";

      button.onmouseenter = null;
      button.onmouseleave = null;

      button.onclick = null;
    }

    function showWebXRNotFound(): void {
      disableButton();
      button.textContent = "VR NOT SUPPORTED";
    }

    function showVRNotAllowed(exception: Error): void {
      disableButton();
      console.warn(
        "Exception when trying to call xr.isSessionSupported",
        exception
      );
      button.textContent = "VR NOT ALLOWED";
    }

    function stylizeElement(element: HTMLElement): void {
      element.style.position = "absolute";
      element.style.bottom = "20px";
      element.style.padding = "12px 6px";
      element.style.border = "1px solid #fff";
      element.style.borderRadius = "4px";
      element.style.background = "rgba(0,0,0,0.1)";
      element.style.color = "#fff";
      element.style.font = "normal 13px sans-serif";
      element.style.textAlign = "center";
      element.style.opacity = "0.5";
      element.style.outline = "none";
      element.style.zIndex = "999";
    }

    if ("xr" in navigator) {
      button.id = "VRButton";
      button.style.display = "none";

      stylizeElement(button);

      if (navigator.xr) {
        // @ts-ignore - Navigator.xr methods are not properly typed
        navigator.xr
          .isSessionSupported("immersive-vr")
          .then(function (supported: boolean) {
            supported ? showEnterVR() : showWebXRNotFound();

            if (supported && VRButton.xrSessionIsGranted) {
              button.click();
            }
          })
          .catch(showVRNotAllowed);
      }

      return button;
    } else {
      const message = document.createElement("a");

      if (window.isSecureContext === false) {
        message.href = document.location.href.replace(/^http:/, "https:");
        message.innerHTML = "WEBXR NEEDS HTTPS"; // TODO Improve message
      } else {
        message.href = "https://immersiveweb.dev/";
        message.innerHTML = "WEBXR NOT AVAILABLE";
      }

      message.style.left = "calc(50% - 90px)";
      message.style.width = "180px";
      message.style.textDecoration = "none";

      stylizeElement(message);

      return message;
    }
  }

  /**
   * Register a listener for the sessiongranted event
   */
  static registerSessionGrantedListener(): void {
    if (typeof navigator !== "undefined" && "xr" in navigator && navigator.xr) {
      // WebXRViewer (based on Firefox) has a bug where addEventListener
      // throws a silent exception and aborts execution entirely.
      if (/WebXRViewer\//i.test(navigator.userAgent)) return;

      // @ts-ignore - Navigator.xr methods are not properly typed
      navigator.xr.addEventListener("sessiongranted", () => {
        VRButton.xrSessionIsGranted = true;
      });
    }
  }
}

// Initialize static variable and register listener
VRButton.xrSessionIsGranted = false;
VRButton.registerSessionGrantedListener();
