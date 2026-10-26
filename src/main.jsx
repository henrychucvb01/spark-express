import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import DemoExperience from "./ordering/DemoExperience";
import FacultyOrdering from "./ordering/FacultyOrdering";
import "./cafe.css";

async function api(action, values = {}) {
  const response = await fetch("/api/account", {
    method: action ? "POST" : "GET",
    headers: action ? { "Content-Type": "application/json" } : undefined,
    body: action ? JSON.stringify({ action, ...values }) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Please try again shortly.");
  return data;
}
function Icon({ type }) {
  const paths = {
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    leaf: (
      <>
        <path d="M5 18C2 9 8 3 20 4c1 11-5 17-13 14M5 20 15 10" />
      </>
    ),
    plate: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="5" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[type] || paths.arrow}
    </svg>
  );
}
function App() {
  const [state, setState] = useState({
    loading: true,
    available: false,
    emailAvailable: false,
    account: null,
  });
  const [view, setView] = useState(() =>
      new URLSearchParams(window.location.search).get("demo") === "1"
        ? "demo"
        : "home",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [recovery, setRecovery] = useState(""),
    [saved, setSaved] = useState(false),
    [resetToken, setResetToken] = useState(""),
    [notice, setNotice] = useState(""),
    [verifySent, setVerifySent] = useState(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "reset",
    );
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      setResetToken(token);
      setView("reset");
      history.replaceState(null, "", location.pathname);
    }
    api()
      .then((data) => setState({ ...data, loading: false }))
      .catch(() => {
        setState({
          loading: false,
          available: false,
          emailAvailable: false,
          account: null,
        });
        setError("We could not connect right now. Please try again shortly.");
      });
  }, []);
  function go(next) {
    setView(next);
    setError("");
    setNotice("");
  }
  async function submit(event, action) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (values.confirmPin !== undefined && values.pin !== values.confirmPin) {
      setError("Your PINs do not match.");
      return;
    }
    delete values.confirmPin;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await api(action, {
        ...values,
        ...(action === "email_reset" ? { token: resetToken } : {}),
      });
      form.reset();
      if (data.account)
        setState((current) => ({ ...current, account: data.account }));
      if (data.recoveryCode) {
        setRecovery(data.recoveryCode);
        setSaved(false);
        setView(action === "register" ? "registered" : "recovered");
        if (action !== "register")
          setState((current) => ({ ...current, account: null }));
        setResetToken("");
      } else if (action === "login") go("dashboard");
      else if (action === "email_send") {
        setVerifySent(true);
        setNotice("Check your email for a 6-digit verification code.");
      } else if (action === "email_verify") {
        setVerifySent(false);
        setNotice("Your recovery email is verified.");
      } else if (action === "email_recover") setNotice(data.message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("logout");
      setState((current) => ({ ...current, account: null }));
      setRecovery("");
      setVerifySent(false);
      go("home");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function order() {
    go(state.account ? "dashboard" : "login");
  }
  function saveCode() {
    const blob = new Blob(
      [
        `Cafe LA Express recovery code\n\n${recovery}\n\nKeep this private. Use it with your employee number to reset your PIN. It can be used once; resetting your PIN replaces this code.\n`,
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "spark-express-recovery-code.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const pinFields = (
    <>
      <label>
        6-digit PIN
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          minLength="6"
          maxLength="6"
          autoComplete={view === "login" ? "current-password" : "new-password"}
          required
        />
      </label>
      {view !== "login" && (
        <label>
          Confirm PIN
          <input
            name="confirmPin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength="6"
            maxLength="6"
            autoComplete="new-password"
            required
          />
        </label>
      )}
    </>
  );
  const feedback = (
    <>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message success" role="status">
          {notice}
        </p>
      )}
    </>
  );
  const recoveryView = view === "registered" || view === "recovered";
  return (
    <>
      <header className="header">
        <button
          className="brand"
          disabled={recoveryView}
          onClick={() => go("home")}
          aria-label="Cafe LA Express home"
        >
          <img
            className="brand-mark"
            src="/spark-192.png"
            alt=""
            width="48"
            height="48"
          />
          <span>
            <b>CAFÉ LA</b>
            <span className="brand-sub">EXPRESS</span>
          </span>
        </button>
        <nav aria-label="Main navigation">
          {!recoveryView && (
            <>
              {state.account ? (
                <>
                  <button
                    className="text-button"
                    onClick={() => go("dashboard")}
                  >
                    My lunch
                  </button>
                  <button
                    className="outline small"
                    disabled={busy}
                    onClick={logout}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <button className="outline small" onClick={() => go("login")}>
                  Faculty sign in <Icon type="arrow" />
                </button>
              )}
            </>
          )}
        </nav>
      </header>
      <main>
        {view === "demo" ? (
          <DemoExperience
            onExit={() => {
              history.replaceState(null, "", location.pathname);
              go("home");
            }}
          />
        ) : view === "home" ? (
          <>
            <section className="hero">
              <div className="hero-copy">
                <p className="eyebrow">
                  <span className="status-dot" /> A LITTLE MORE TIME FOR YOU
                </p>
                <h1>
                  Lunch just
                  <br />
                  <em>got easier.</em>
                </h1>
                <p className="intro">
                  Good food. Your campus. One less thing to think about.
                </p>
                <p className="hero-description">
                  Choose your lunch ahead of time and let your cafeteria take
                  care of the rest. Made for the people who make school happen.
                </p>
                <button className="primary" onClick={order}>
                  Order lunch <Icon type="arrow" />
                </button>
                <button
                  className="outline demo-entry"
                  onClick={() => {
                    history.replaceState(null, "", "?demo=1");
                    go("demo");
                  }}
                >
                  Try the faculty demo →
                </button>
                <p className="join-note">
                  New here?{" "}
                  <button
                    className="inline-button"
                    onClick={() => go("register")}
                  >
                    Create your faculty account
                  </button>
                </p>
              </div>
              <figure className="cafe-hero-photo">
                <img src="/menu-photos/chicken-rice.webp" alt="Sample chicken and rice lunch with fresh vegetables" width="1200" height="800" fetchPriority="high" />
                <figcaption><span>GOOD FOOD. A LITTLE MORE YOU TIME.</span><small>Sample food photography · Actual school menus vary</small></figcaption>
              </figure>
            </section>
            <section className="how" aria-labelledby="how-title">
              <div className="section-intro">
                <p className="eyebrow">LESS WAITING. MORE LUNCH BREAK.</p>
                <h2 id="how-title">
                  Three simple steps.
                  <br />
                  One lovely lunch.
                </h2>
              </div>
              <div className="steps">
                {[
                  [
                    "01",
                    "Make it yours",
                    "Sign in and choose from your school’s menu for today.",
                  ],
                  [
                    "02",
                    "We’ll get cooking",
                    "Your order goes straight to your cafeteria’s preparation queue.",
                  ],
                  [
                    "03",
                    "Pick up & enjoy",
                    "Scan your lunch ticket, then pay through the district POS.",
                  ],
                ].map(([n, title, text]) => (
                  <article key={n}>
                    <span className="step-number">{n}</span>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </article>
                ))}
              </div>
            </section>
            <section className="pilot-note">
              <Icon type="sun" />
              <div>
                <h3>Starting at Banning High School</h3>
                <p>
                  We’re getting the first faculty lunch experience ready.
                  Account registration opens when the pilot is ready.
                </p>
              </div>
              <span className="pill">FACULTY PILOT</span>
            </section>
            {error && <div className="home-feedback">{feedback}</div>}
          </>
        ) : recoveryView ? (
          <section className="account-shell">
            <div className="account-card wide">
              <span className="round-icon">
                <Icon type="check" />
              </span>
              <p className="eyebrow">
                {view === "registered"
                  ? "WELCOME TO CAFE LA EXPRESS"
                  : "YOUR PIN HAS BEEN RESET"}
              </p>
              <h1>Save your way back in.</h1>
              <p>
                This private recovery code lets you reset your PIN without
                asking your cafeteria manager. Save it somewhere safe.
              </p>
              <output
                className="recovery-code"
                aria-label="Your private recovery code"
              >
                {recovery}
              </output>
              <button className="outline" onClick={saveCode}>
                Download recovery code
              </button>
              <p className="hint">
                This code is shown once. Each PIN reset replaces it with a new
                one.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(e) => setSaved(e.target.checked)}
                />{" "}
                I saved my recovery code.
              </label>
              <button
                className="primary full"
                disabled={!saved}
                onClick={() => {
                  setRecovery("");
                  go(state.account ? "dashboard" : "login");
                }}
              >
                Continue <Icon type="arrow" />
              </button>
              {feedback}
            </div>
          </section>
        ) : view === "dashboard" && state.account ? (
          <section className="dashboard">
            <div className="dashboard-heading">
              <p className="eyebrow">
                {state.account.schoolName} · {state.account.schoolCode}
              </p>
              <h1>
                Welcome back, {state.account.name.split(" ")[0]}.
                <em> Lunch just got easier.</em>
              </h1>
            </div>
            <div className="dashboard-grid">
              <FacultyOrdering />
              <section className="recovery-panel">
                <h2>A little peace of mind.</h2>
                <p>
                  Your saved recovery code can help you get back into your
                  account.
                </p>
                {state.account.email ? (
                  <p className="message success">
                    Recovery email verified: {state.account.email}
                  </p>
                ) : state.emailAvailable ? (
                  <>
                    <form onSubmit={(e) => submit(e, "email_send")}>
                      <label>
                        Optional recovery email
                        <input
                          name="email"
                          type="email"
                          autoComplete="email"
                          maxLength="254"
                          required
                        />
                      </label>
                      <button className="outline full" disabled={busy}>
                        Send verification code
                      </button>
                    </form>
                    {verifySent && (
                      <form onSubmit={(e) => submit(e, "email_verify")}>
                        <label>
                          Email verification code
                          <input
                            name="code"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength="6"
                            autoComplete="one-time-code"
                            required
                          />
                        </label>
                        <button className="primary full" disabled={busy}>
                          Verify email
                        </button>
                      </form>
                    )}
                  </>
                ) : (
                  <p className="hint">
                    Optional email recovery is being set up. Keep your recovery
                    code safe.
                  </p>
                )}
              </section>
            </div>
            {feedback}
          </section>
        ) : (
          <section className="account-shell">
            <div className="account-aside">
              <p className="eyebrow">YOUR CAMPUS CAFÉ, A TAP AWAY.</p>
              <h2>
                Your break.
                <br />
                <em>Well deserved.</em>
              </h2>
              <p>A fresh way to order lunch, made for faculty.</p>
              <div className="aside-line" />
              <span>CAFE LA EXPRESS</span>
            </div>
            <div className="account-card">
              <button className="back-link" onClick={() => go("home")}>
                ← Back to café
              </button>
              <p className="eyebrow">FACULTY ACCESS</p>
              <h1>
                {view === "register"
                  ? "Make yourself at home."
                  : view === "recover" || view === "reset"
                    ? "A fresh start."
                    : view === "emailRecovery"
                      ? "Let’s get you back in."
                      : "Welcome back."}
              </h1>
              {state.loading ? (
                <p role="status">Checking account availability…</p>
              ) : !state.available ? (
                <>
                  <p>
                    We’re preparing the Banning High School pilot. Faculty
                    account access will open once setup is complete.
                  </p>
                  <div className="message neutral">
                    Account registration is not open yet.
                  </div>
                  <button
                    className="outline"
                    onClick={() => window.location.reload()}
                  >
                    Check again
                  </button>
                </>
              ) : view === "register" ? (
                <>
                  <p>
                    Use your district employee number to create your account.
                    Your school will be assigned automatically.
                  </p>
                  <form onSubmit={(e) => submit(e, "register")}>
                    <label>
                      District employee number
                      <input
                        name="employeeNumber"
                        inputMode="numeric"
                        pattern="[0-9]{1,20}"
                        maxLength="20"
                        autoComplete="off"
                        required
                      />
                    </label>
                    {pinFields}
                    {feedback}
                    <button className="primary full" disabled={busy}>
                      {busy ? "Creating your account…" : "Create account"}{" "}
                      <Icon type="arrow" />
                    </button>
                  </form>
                  <p className="switch-note">
                    Already registered?{" "}
                    <button
                      className="inline-button"
                      onClick={() => go("login")}
                    >
                      Sign in
                    </button>
                  </p>
                </>
              ) : view === "recover" ? (
                <>
                  <p>
                    Use the recovery code you saved when you created your
                    account.
                  </p>
                  <form onSubmit={(e) => submit(e, "recover")}>
                    <label>
                      District employee number
                      <input
                        name="employeeNumber"
                        inputMode="numeric"
                        pattern="[0-9]{1,20}"
                        maxLength="20"
                        autoComplete="off"
                        required
                      />
                    </label>
                    <label>
                      Saved recovery code
                      <input
                        name="recoveryCode"
                        type="password"
                        maxLength="60"
                        autoComplete="off"
                        required
                      />
                    </label>
                    {pinFields}
                    {feedback}
                    <button className="primary full" disabled={busy}>
                      {busy ? "Resetting…" : "Reset PIN"}
                    </button>
                  </form>
                  {state.emailAvailable && (
                    <p className="switch-note">
                      <button
                        className="inline-button"
                        onClick={() => go("emailRecovery")}
                      >
                        Use verified email instead
                      </button>
                    </p>
                  )}
                  <p className="switch-note">
                    <button
                      className="inline-button"
                      onClick={() => go("login")}
                    >
                      Back to sign in
                    </button>
                  </p>
                </>
              ) : view === "emailRecovery" ? (
                <>
                  <p>Enter the recovery email you previously verified.</p>
                  <form onSubmit={(e) => submit(e, "email_recover")}>
                    <label>
                      Verified recovery email
                      <input
                        name="email"
                        type="email"
                        maxLength="254"
                        autoComplete="email"
                        required
                      />
                    </label>
                    {feedback}
                    <button className="primary full" disabled={busy}>
                      {busy ? "Sending…" : "Send reset link"}
                    </button>
                  </form>
                  <p className="switch-note">
                    <button
                      className="inline-button"
                      onClick={() => go("recover")}
                    >
                      Use saved recovery code
                    </button>
                  </p>
                </>
              ) : view === "reset" ? (
                <>
                  <p>
                    Choose a new PIN. This link can be used once within 15
                    minutes.
                  </p>
                  <form onSubmit={(e) => submit(e, "email_reset")}>
                    {pinFields}
                    {feedback}
                    <button className="primary full" disabled={busy}>
                      {busy ? "Resetting…" : "Set new PIN"}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p>
                    Sign in with your full name as listed on the school roster
                    and your personal PIN.
                  </p>
                  <form onSubmit={(e) => submit(e, "login")}>
                    <label>
                      Your full name
                      <input
                        name="name"
                        autoComplete="username"
                        maxLength="160"
                        required
                      />
                    </label>
                    {pinFields}
                    <details className="same-name">
                      <summary>Need to distinguish your account?</summary>
                      <label>
                        District employee number
                        <input
                          name="employeeNumber"
                          inputMode="numeric"
                          pattern="[0-9]{1,20}"
                          maxLength="20"
                          autoComplete="off"
                        />
                      </label>
                      <p className="hint">
                        Enter this if you share a name with another employee.
                      </p>
                    </details>
                    {feedback}
                    <button className="primary full" disabled={busy}>
                      {busy ? "Signing in…" : "Sign in"} <Icon type="arrow" />
                    </button>
                  </form>
                  <button
                    className="inline-button forgot"
                    onClick={() => go("recover")}
                  >
                    Forgot your PIN?
                  </button>
                  <p className="switch-note">
                    First time here?{" "}
                    <button
                      className="inline-button"
                      onClick={() => go("register")}
                    >
                      Create account
                    </button>
                  </p>
                </>
              )}
            </div>
          </section>
        )}
      </main>
      <footer className="footer">
        <span className="footer-brand">
          <img src="/spark-192.png" alt="" width="28" height="28" />
          CAFE LA EXPRESS <i>✦</i> SCHOOL MEALS
        </span>
        <span>A good lunch makes a good day.</span>
        <span>Faculty lunch, thoughtfully made.</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
