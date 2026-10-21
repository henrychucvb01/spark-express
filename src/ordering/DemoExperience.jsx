import React, { useRef, useState } from "react";
import OrderingExperience from "./OrderingExperience";
import { createDemoStore, DEMO_NAME, DEMO_PIN } from "./demo";
export default function DemoExperience({ onExit }) {
  const [signedIn, setSignedIn] = useState(false),
    [error, setError] = useState("");
  const store = useRef(null);
  store.current ??= createDemoStore();
  return (
    <section className="dashboard demo-experience">
      <div className="demo-banner">
        <span>
          <b>SPARK Express demo</b> · Fictional faculty account
        </span>
        <button className="inline-button" onClick={onExit}>
          Exit demo
        </button>
      </div>
      {signedIn ? (
        <>
          <div className="dashboard-heading">
            <p className="eyebrow">BANNING HS · SAMPLE WORKFLOW</p>
            <h1>
              Hello, Demo Faculty.
              <br />
              <em>Let’s make lunch easy.</em>
            </h1>
          </div>
          <OrderingExperience
            load={store.current.load}
            placeOrder={store.current.place}
            demoStore={store.current}
          />
          <button
            className="inline-button demo-reset"
            onClick={() => {
              store.current.reset();
              setSignedIn(false);
            }}
          >
            Start demo again
          </button>
        </>
      ) : (
        <div className="account-card demo-login">
          <p className="eyebrow">TAKE A LOOK AROUND</p>
          <h1>Try your lunch break.</h1>
          <p>
            Use this dummy account to choose a sample meal, review it, place an
            order, and walk through preparation and pickup.
          </p>
          <div className="demo-credentials">
            <span>
              Name: <b>{DEMO_NAME}</b>
            </span>
            <span>
              PIN: <b>{DEMO_PIN}</b>
            </span>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              if (
                String(data.get("name")).trim().toLowerCase() ===
                  DEMO_NAME.toLowerCase() &&
                data.get("pin") === DEMO_PIN
              ) {
                setSignedIn(true);
                setError("");
              } else setError("Use the demo name and PIN shown above.");
            }}
          >
            <label>
              Your name
              <input
                name="name"
                autoComplete="off"
                defaultValue={DEMO_NAME}
                required
              />
            </label>
            <label>
              Demo PIN
              <input
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                defaultValue={DEMO_PIN}
                required
                maxLength="6"
              />
            </label>
            {error && (
              <p className="message error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full">Sign in to demo →</button>
          </form>
          <p className="hint">
            Nothing is sent to a cafeteria. This practice account stays separate
            from real faculty accounts, and the demo resets when you refresh.
          </p>
        </div>
      )}
    </section>
  );
}
