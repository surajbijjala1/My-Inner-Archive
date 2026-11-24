import { useState, useEffect, useCallback, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getRememberedUsername, getPinLength, checkUsername } from "../api";
import { prefersReducedMotion } from "../motion";

/** Round the ring clockwise from the top: 0, then 1 to 9 (5 at the foot). */
const DIGITS: string[] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const ERASE = "⌫";

/* The way back: an arrow turning anticlockwise round the medallion's boss. */
const TurnBackMark = () => (
  <svg className="pin-undo-mark" viewBox="0 0 40 40" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.5 21.5a11 11 0 1 0 3.4-9.4" />
    <path d="M7.2 8.2l5.3 4.2-5.6 3.4" />
  </svg>
);

type UsernameStatus = null | "checking" | "available" | "taken";

interface PinPadProps {
  mode: "setup" | "login";
  onSuccess: (username: string, pin: string, pinLength?: number) => Promise<void>;
  onBack?: () => void;
  error?: string;
  /** "New here?" on the login form: to the sign-up form. */
  onNew?: () => void;
  /** How much of the PIN is typed, 0–1. The book's clasp lifts with it. */
  onProgress?: (fraction: number) => void;
  /** Lays the parts out in the scene (DiaryScene). */
  frame: (parts: PinParts) => ReactNode;
}

/** The pad in pieces, so the scene can put each where it belongs. */
export interface PinParts {
  /** The name, the ring of digits and the links: stamped in gold on the book's cover. */
  cover: ReactNode;
  /** The slip of paper an error is written on, at the book's foot. */
  foot: ReactNode;
}

export default function PinPad({ mode, onSuccess, onBack, onNew, error: externalError, onProgress, frame }: PinPadProps) {
  const [username, setUsername] = useState(getRememberedUsername());
  const [input, setInput] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [phase, setPhase] = useState<"enter" | "confirm">("enter");
  const [loading, setLoading] = useState(false);
  const [pinLength, setPinLength] = useState<4 | 6>(4);
  const [fetchingPinLen, setFetchingPinLen] = useState(false);
  // Sign-up asks how long the PIN should be before the ring appears.
  const [lengthChosen, setLengthChosen] = useState(false);
  const choosing = mode === "setup" && phase === "enter" && !lengthChosen;
  const chooseLength = (n: 4 | 6) => {
    setPinLength(n);
    setInput("");
    setErr("");
    setLengthChosen(true);
  };
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

  // Taking a digit back turns the medallion a little anticlockwise; it springs home.
  const undoRef = useRef<HTMLButtonElement | null>(null);
  const turnBack = () => {
    if (prefersReducedMotion()) return;
    undoRef.current?.animate(
      [
        { rotate: "0deg" },
        { rotate: "-46deg", offset: 0.38, easing: "cubic-bezier(0.3, 0, 0.2, 1)" },
        { rotate: "5deg", offset: 0.8 },
        { rotate: "0deg" },
      ],
      { duration: 460, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
    );
  };

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
      // Sign-up, before the ring: the only keys that mean anything are 4 and 6.
      if (choosing) {
        if (v === "4" || v === "6") chooseLength(v === "4" ? 4 : 6);
        return;
      }
      if (v === ERASE) {
        if (input.length > 0) turnBack();
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
    [input, pinLength, loading, choosing]
  );

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") press(e.key);
      if (e.key === "Backspace") press(ERASE);
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

  // The cover speaks in lowercase asides rather than instructions.
  const getSubtitle = (): string => {
    if (loading) return mode === "setup" ? "setting things up\u2026" : "one moment\u2026";
    if (mode === "setup") {
      if (choosing) return "how long a PIN?";
      if (phase === "confirm") return "once more";
      return "choose a new one";
    }
    return fetchingPinLen ? "one moment\u2026" : "your PIN";
  };

  // Whether the chosen name is free (sign-up only).
  const statusText = (): string => {
    if (mode !== "setup" || !username.trim() || username.trim().length < 2) return "";
    if (usernameStatus === "checking") return "checking\u2026";
    if (usernameStatus === "available") return "that one's free";
    if (usernameStatus === "taken") return "already taken";
    return "";
  };
  const status = statusText();

  // Everything on the cover is stamped in gold. `data-foil` is the order the
  // stamping reaches it in (foilReveal.ts): the digits 0–9, then the words.
  const cover = (
    <>
      <div className="foil-name">
        <span className={`foil foil-status${status ? " foil-status--on" : ""}`} aria-live="polite">
          {status}
        </span>
        <input
          className="foil pin-username-input"
          data-foil={10}
          type="text"
          placeholder="Your Name"
          aria-label="Your name"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => { setUsername(e.target.value); setErr(""); }}
          disabled={loading || (mode === "setup" && phase === "confirm")}
          autoFocus={!username}
        />
      </div>

      <div className="pin-lock" ref={lockRef}>
        {/* No dots: the book's clasp shows how far the PIN has got. This says it aloud. */}
        <span className="visually-hidden" role="status">
          {choosing ? "" : `${input.length} of ${pinLength} digits entered`}
        </span>

        {choosing ? (
          <div className="pin-lengths" role="group" aria-label="How many digits should your PIN have?">
            {([4, 6] as const).map((n, i) => (
              <button
                key={n}
                className="foil pin-length-btn"
                data-foil={i === 0 ? 2 : 7}
                onClick={() => chooseLength(n)}
                aria-label={`${n} digits`}
              >
                <span className="pin-length-num">{n}</span>
                <span className="pin-length-word">digits</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="pin-ring" role="group" aria-label="PIN digits">
              {DIGITS.map((n, i) => (
                <button
                  key={n}
                  className="foil pin-num-btn"
                  data-foil={i}
                  style={{ "--i": i } as CSSProperties}
                  onClick={() => press(n)}
                  disabled={loading}
                >
                  {n}
                </button>
              ))}
            </div>
            {/* The way back is the medallion itself: press it and it turns back a digit. */}
            <button
              ref={undoRef}
              className={`pin-undo${input.length > 0 ? " pin-undo--ready" : ""}`}
              onClick={() => press(ERASE)}
              disabled={loading || input.length === 0}
              aria-label="Delete last digit"
              title="Turn back a digit"
            >
              <TurnBackMark />
            </button>
          </>
        )}
      </div>

      <div className="foil-foot">
        <div className="foil foil-prompt" data-foil={11}>
          {getSubtitle()}
          {mode === "setup" && phase === "enter" && lengthChosen && !loading && (
            <>
              {" \u00b7 "}
              <button
                className="foil-change"
                onClick={() => { setLengthChosen(false); setInput(""); }}
                aria-label={`${pinLength} digits. Change the PIN length`}
              >
                {pinLength} digits
              </button>
            </>
          )}
        </div>

        {mode === "setup" && onBack && (
          <button className="foil foil-link" data-foil={12} onClick={onBack}>
            Already have one?
          </button>
        )}
        {mode === "login" && (
          <button className="foil foil-link" data-foil={12} onClick={onNew ?? (() => window.location.reload())}>
            New here?
          </button>
        )}
      </div>
    </>
  );

  const foot = (
    // Always present, so a screen reader hears the error when it arrives.
    <div className={`pin-slip${displayError ? " pin-slip--out" : ""}`}>
      <div className="pin-error" role="alert">{displayError}</div>
    </div>
  );

  return <>{frame({ cover, foot })}</>;
}
