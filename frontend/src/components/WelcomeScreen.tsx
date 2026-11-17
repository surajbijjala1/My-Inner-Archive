const FEATURES: [string, string, string][] = [
  ["📝", "Capture thoughts", "Write anything, any time. Timestamped and private."],
  ["🏷️", "Tag your context", "Record where you were when the insight hit."],
  ["📈", "Mood timeline", "See your emotional patterns over time, automatically."],
  ["🤖", "AI from your words", "Your archive answers with only your own words."],
  ["📅", "On This Day", "See what you wrote on this date in past years."],
];

interface WelcomeScreenProps {
  onGetStarted: () => void;
  onLogIn: () => void;
}

/** The first page someone without an account sees: a loose sheet on the desk (DiaryScene). */
export default function WelcomeScreen({ onGetStarted, onLogIn }: WelcomeScreenProps) {
  return (
    <div className="welcome-card">
        <div className="welcome-title">My Inner Archive</div>
        <div className="welcome-desc">
          A private space to capture your thoughts and let AI reflect your own wisdom back to you.
        </div>
        <div className="welcome-features">
          {FEATURES.map(([icon, title, desc]) => (
            <div key={title} className="welcome-feature">
              <div className="welcome-feature-icon">{icon}</div>
              <div>
                <div className="welcome-feature-title">{title}</div>
                <div className="welcome-feature-desc">{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <button className="welcome-cta" onClick={onGetStarted}>Get Started →</button>
        <div className="pin-footnote">
          <button className="pin-footnote-link" onClick={onLogIn}>
            already have one? log in
          </button>
        </div>
        <div className="welcome-footer">yours alone, kept private</div>
    </div>
  );
}
