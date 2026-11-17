import { useState, useEffect, useCallback, useRef } from "react";
import { getRememberedUsername, getPinLength, checkUsername } from "../api";
import { prefersReducedMotion } from "../motion";

const NUMS: string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

/* Drawn, not typed — the design uses a hand-inked backspace here. */
const EraseIcon = () => (
  <svg width="26" height="20" viewBox="0 0 26 20" fill="none" stroke="currentColor"
    strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
    <path d="M9 2.6h14.2c.9 0 1.5.7 1.5 1.6v11.6c0 .9-.6 1.6-1.5 1.6H9L1.6 10.4c-.3-.3-.3-.7 0-1L9 2.6Z" />
    <path d="M13.4 7.6l5.4 4.8" />
    <path d="M18.8 7.6l-5.4 4.8" />
  </svg>
);

type UsernameStatus = null | "checking" | "available" | "taken";

interface PinPadProps {
  mode: "setup" | "login";
  onSuccess: (username: string, pin: string, pinLength?: number) => Promise<void>;
  onBack?: () => void;
  error?: string;
  /** How much of the PIN is typed, 0–1. The scene's lamp brightens with it. */
  onProgress?: (fraction: number) => void;
}

export default function PinPad({ mode, onSuccess, onBack, error: externalError, onProgress }: PinPadProps) {
  const [username, setUsername] = useState(getRememberedUsername());
  const [input, setInput] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [phase, setPhase] = useState<"enter" | "confirm">("enter");
  const [loading, setLoading] = useState(false);
  const [pinLength, setPinLength] = useState<4 | 6>(4);
  const [fetchingPinLen, setFetchingPinLen] = useState(false);
  const pinLengthRef = useRef<4 | 6>(pinLength);
  useEffect(() => {
    pinLengthRef.current = pinLength;
  }, [pinLength]);

  // Username availability state (setup mode only)
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayError = err || externalError || "";

  // A refused PIN shakes the lock. Counted, so the same message twice in a
  // row still shakes twice.
  const [refusals, setRefusals] = useState(0);
  const lockRef = useRef<HTMLDivElement | null>(null);
  const refuse = (message: string) => {
    setErr(message);
    setRefusals((n) => n + 1);
  };

  useEffect(() => {
    if (refusals === 0 || prefersReducedMotion()) return;
    lockRef.current?.animate(
      [
        { transform: "translateX(0) rotate(0)" },
        { transform: "translateX(-7px) rotate(-1.1deg)" },
        { transform: "translateX(6px) rotate(0.9deg)" },
        { transform: "translateX(-4px) rotate(-0.5deg)" },
        { transform: "translateX(2px) rotate(0.2deg)" },
        { transform: "translateX(0) rotate(0)" },
      ],
      { duration: 420, easing: "ease-out" }
    );
  }, [refusals]);

  useEffect(() => {
    onProgress?.(input.length / pinLength);
  }, [input.length, pinLength, onProgress]);

  // On login mode: fetch PIN length when username settles (debounced)
  useEffect(() => {
    if (mode !== "login" || !username.trim()) {
      setPinLength(4);
      return;
    }
    const timer = setTimeout(async () => {
      setFetchingPinLen(true);
      const len = (await getPinLength(username.trim())) === 6 ? 6 : 4;
      // Reset the dots only if the length really changed: the pad is usable
      // the moment it appears, and digits typed while this lookup was in
      // flight used to be wiped when it came back.
      if (len !== pinLengthRef.current) setInput("");
      setPinLength(len);
      setFetchingPinLen(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [username, mode]);

  // On setup mode: check username availability (debounced)
  useEffect(() => {
    if (mode !== "setup") {
      setUsernameStatus(null);
      return;
    }

    if (!username.trim() || username.trim().length < 2) {
      setUsernameStatus(null);
      return;
    }

    setUsernameStatus("checking");

    if (checkTimer.current) clearTimeout(checkTimer.current);
    checkTimer.current = setTimeout(async () => {
      const result = await checkUsername(username.trim());
      setUsernameStatus(result.available ? "available" : "taken");
    }, 600);

    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    };
  }, [username, mode]);

  const press = useCallback(
    (v: string) => {
      if (loading) return;
      if (v === "") return;
      if (v === "⌫") {
        setInput((p) => p.slice(0, -1));
        setErr("");
        return;
      }
      if (input.length >= pinLength) return;

      const next = input + v;
      setInput(next);

      if (next.length === pinLength) {
        setTimeout(() => handleComplete(next), 150);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, pinLength, loading]
  );

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") press(e.key);
      if (e.key === "Backspace") press("⌫");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [press]);

  const handleComplete = async (pin: string) => {
    if (!username.trim()) {
      setErr("Please enter a username first.");
      setInput("");
      return;
    }

    // Block registration if username is taken
    if (mode === "setup" && usernameStatus === "taken") {
      setErr("Username already exists. Try a different name.");
      setInput("");
      return;
    }

    if (mode === "setup") {
      if (phase === "enter") {
        setConfirm(pin);
        setInput("");
        setPhase("confirm");
      } else {
        if (pin === confirm) {
          setLoading(true);
          try {
            await onSuccess(username.trim(), pin, pinLength);
          } catch (e) {
            refuse((e as Error).message || "Setup failed");
            setInput("");
            setPhase("enter");
            setConfirm(null);
          }
          setLoading(false);
        } else {
          refuse("PINs don't match. Try again.");
          setInput("");
          setPhase("enter");
          setConfirm(null);
        }
      }
    } else {
      setLoading(true);
      try {
        await onSuccess(username.trim(), pin);
      } catch (e) {
        refuse((e as Error).message || "Login failed");
        setInput("");
      }
      setLoading(false);
    }
  };

  // The design speaks in lowercase asides rather than instructions.
  const getSubtitle = (): string => {
    if (mode === "setup") {
      if (phase === "confirm") return "once more";
      return "choose a new one";
    }
    return fetchingPinLen ? "one moment\u2026" : "your PIN";
  };

  // Username status indicator for setup mode
  const renderUsernameStatus = () => {
    if (mode !== "setup" || !username.trim() || username.trim().length < 2) return null;

    if (usernameStatus === "checking") {
      return <span className="username-status username-status--checking">checking&hellip;</span>;
    }
    if (usernameStatus === "available") {
      return <span className="username-status username-status--available">that one's free</span>;
    }
    if (usernameStatus === "taken") {
      return <span className="username-status username-status--taken">already taken</span>;
    }
    return null;
  };

  // Drawn on the diary's cover (DiaryScene): the title tooled into the
  // leather, the name on a paper label, and the pad set into the brass lock.
  return (
    <div className="pin-wrap">
      <div className="pin-title">My Inner Archive</div>
      <div className="pin-subtitle">
        {mode === "setup" ? "let's begin" : "welcome back"}
      </div>

      <div className="username-field">
        <input
          className="pin-username-input"
          type="text"
          placeholder="your name"
          aria-label="Your name"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => { setUsername(e.target.value); setErr(""); }}
          disabled={loading || (mode === "setup" && phase === "confirm")}
          autoFocus={!username}
        />
        {renderUsernameStatus()}
      </div>

      {/* PIN length toggle — setup mode, first phase only */}
      {mode === "setup" && phase === "enter" && (
        <div className="pin-length-toggle">
          <button
            className={`pin-length-btn ${pinLength === 4 ? "pin-length-btn--active" : ""}`}
            aria-pressed={pinLength === 4}
            onClick={() => { setPinLength(4); setInput(""); }}
          >
            4 digits
          </button>
          <button
            className={`pin-length-btn ${pinLength === 6 ? "pin-length-btn--active" : ""}`}
            aria-pressed={pinLength === 6}
            onClick={() => { setPinLength(6); setInput(""); }}
          >
            6 digits
          </button>
        </div>
      )}

      <div className="pin-lock" ref={lockRef}>
        <div className="pin-subtitle pin-subtitle--prompt">
          {getSubtitle()}
        </div>

        <div
          className="pin-dots"
          role="img"
          aria-label={`${input.length} of ${pinLength} digits entered`}
        >
          {Array.from({ length: pinLength }).map((_, i) => (
            <div
              key={i}
              className={`pin-dot ${i < input.length ? "pin-dot--filled" : "pin-dot--empty"}`}
            />
          ))}
        </div>

        <div className="pin-numpad">
          {NUMS.map((n, i) => (
            <button
              key={i}
              className={`pin-num-btn ${n === "⌫" ? "pin-num-btn--erase" : ""}`}
              style={{ visibility: n === "" ? "hidden" : "visible" }}
              onClick={() => press(n)}
              disabled={loading}
              aria-label={n === "⌫" ? "Delete" : undefined}
            >
              {n === "⌫" ? <EraseIcon /> : n}
            </button>
          ))}
        </div>
      </div>

      {/* Always present, so a screen reader hears the error when it arrives. */}
      <div className="pin-error" role="alert">{displayError}</div>

      {mode === "setup" && onBack && (
        <div className="pin-footnote">
          already have one?{" "}
          <button className="pin-footnote-link" onClick={onBack}>
            log in
          </button>
        </div>
      )}

      {mode === "login" && (
        <div className="pin-footnote">
          new here?{" "}
          <button className="pin-footnote-link" onClick={() => window.location.reload()}>
            start one
          </button>
        </div>
      )}

      {loading && (
        <div className="loading-pulse pin-footnote">
          {mode === "setup" ? "setting things up\u2026" : "one moment\u2026"}
        </div>
      )}
    </div>
  );
}
