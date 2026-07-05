import { useState, useEffect, useCallback, useRef } from "react";
import { getRememberedUsername, getPinLength, checkUsername } from "../api";

const NUMS: string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

type UsernameStatus = null | "checking" | "available" | "taken";

interface PinPadProps {
  mode: "setup" | "login";
  onSuccess: (username: string, pin: string, pinLength?: number) => Promise<void>;
  onBack?: () => void;
  error?: string;
}

export default function PinPad({ mode, onSuccess, onBack, error: externalError }: PinPadProps) {
  const [username, setUsername] = useState(getRememberedUsername());
  const [input, setInput] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [phase, setPhase] = useState<"enter" | "confirm">("enter");
  const [loading, setLoading] = useState(false);
  const [pinLength, setPinLength] = useState<4 | 6>(4);
  const [fetchingPinLen, setFetchingPinLen] = useState(false);

  // Username availability state (setup mode only)
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayError = err || externalError || "";

  // On login mode: fetch PIN length when username settles (debounced)
  useEffect(() => {
    if (mode !== "login" || !username.trim()) {
      setPinLength(4);
      return;
    }
    const timer = setTimeout(async () => {
      setFetchingPinLen(true);
      const len = await getPinLength(username.trim());
      setPinLength(len === 6 ? 6 : 4);
      setInput(""); // reset dots if length changed
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
            setErr((e as Error).message || "Setup failed");
            setInput("");
            setPhase("enter");
            setConfirm(null);
          }
          setLoading(false);
        } else {
          setErr("PINs don't match. Try again.");
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
        setErr((e as Error).message || "Login failed");
        setInput("");
      }
      setLoading(false);
    }
  };

  const getSubtitle = (): string => {
    if (mode === "setup") {
      if (phase === "confirm") return `Confirm your ${pinLength}-digit PIN`;
      return `Create a ${pinLength}-digit PIN`;
    }
    return fetchingPinLen ? "Checking account..." : "Enter your PIN to unlock";
  };

  // Username status indicator for setup mode
  const renderUsernameStatus = () => {
    if (mode !== "setup" || !username.trim() || username.trim().length < 2) return null;

    if (usernameStatus === "checking") {
      return <span className="username-status username-status--checking">⏳ Checking...</span>;
    }
    if (usernameStatus === "available") {
      return <span className="username-status username-status--available">✓ Available</span>;
    }
    if (usernameStatus === "taken") {
      return <span className="username-status username-status--taken">✕ Already taken</span>;
    }
    return null;
  };

  return (
    <div className="center-screen">
      <div className="pin-wrap">
        <div className="pin-icon">🌱</div>
        <div className="pin-title">My Inner Archive</div>
        <div className="pin-subtitle">
          {mode === "setup" ? "Create your account" : "Welcome back"}
        </div>

        <div className="username-field">
          <input
            className="pin-username-input"
            type="text"
            placeholder="Enter username"
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
              onClick={() => { setPinLength(4); setInput(""); }}
            >
              4-digit
            </button>
            <button
              className={`pin-length-btn ${pinLength === 6 ? "pin-length-btn--active" : ""}`}
              onClick={() => { setPinLength(6); setInput(""); }}
            >
              6-digit
            </button>
          </div>
        )}

        <div className="pin-subtitle" style={{ marginBottom: 12 }}>
          {getSubtitle()}
        </div>

        <div className="pin-dots">
          {Array.from({ length: pinLength }).map((_, i) => (
            <div
              key={i}
              className={`pin-dot ${i < input.length ? "pin-dot--filled" : "pin-dot--empty"}`}
            />
          ))}
        </div>

        {displayError && <div className="pin-error">{displayError}</div>}

        <div className="pin-numpad">
          {NUMS.map((n, i) => (
            <button
              key={i}
              className="pin-num-btn"
              style={{ visibility: n === "" ? "hidden" : "visible" }}
              onClick={() => press(n)}
              disabled={loading}
            >
              {n}
            </button>
          ))}
        </div>

        {mode === "setup" && onBack && (
          <div style={{ fontSize: "12px", color: "#aaa", marginTop: 4 }}>
            Already have an account?{" "}
            <button
              onClick={onBack}
              style={{
                background: "none", border: "none", color: "#1a1a1a",
                cursor: "pointer", fontWeight: 600, fontSize: "12px",
                padding: 0, fontFamily: "inherit",
              }}
            >
              Log in
            </button>
          </div>
        )}

        {mode === "login" && (
          <div style={{ fontSize: "12px", color: "#aaa", marginTop: 4 }}>
            Don't have an account?{" "}
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "none", border: "none", color: "#1a1a1a",
                cursor: "pointer", fontWeight: 600, fontSize: "12px",
                padding: 0, fontFamily: "inherit",
              }}
            >
              Create one
            </button>
          </div>
        )}

        {loading && (
          <div className="loading-pulse" style={{ fontSize: "13px", color: "#aaa", marginTop: 8 }}>
            {mode === "setup" ? "Creating account..." : "Verifying..."}
          </div>
        )}
      </div>
    </div>
  );
}
