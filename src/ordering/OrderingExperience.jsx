import React, { useEffect, useRef, useState } from "react";
import { ORDER_STATUSES } from "./demo";
import "./ordering.css";
const categories = [
  ["entree", "Choose your entrée"],
  ["fruit", "Add a fruit"],
  ["vegetable", "Pick a vegetable"],
  ["milk", "Choose your milk"],
];
const money = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export default function OrderingExperience({
  load,
  placeOrder,
  demoStore = null,
}) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selections, setSelections] = useState({}),
    [review, setReview] = useState(false),
    [activeOrder, setActiveOrder] = useState(null),
    [scan, setScan] = useState(false);
  const request = useRef(null),
    inFlight = useRef(false),
    alive = useRef(true);
  const refresh = async () => {
    const next = await load();
    if (alive.current) {
      setData(next);
      setActiveOrder((current) =>
        current
          ? next.orders?.find((x) => x.id === current.id) || current
          : null,
      );
    }
    return next;
  };
  useEffect(() => {
    alive.current = true;
    refresh().catch((e) => {
      if (alive.current) setError(e.message);
    });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    }, 15000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [load]);
  async function place() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    request.current ??= crypto.randomUUID();
    try {
      const order = await placeOrder({
        requestId: request.current,
        menuId: data.menu.id,
        revision: data.menu.revision,
        selections,
      });
      setActiveOrder(order);
      setReview(false);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const complete = categories.every(([key]) => selections[key]);
  function choose(category, id) {
    setSelections((current) => ({ ...current, [category]: id }));
    request.current = null;
    setError("");
  }
  async function simulate(action) {
    setError("");
    try {
      action();
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  if (!data)
    return (
      <div className="ordering-panel">
        <p role="status">Getting your lunch spot ready…</p>
        {error && (
          <p role="alert" className="message error">
            {error}
          </p>
        )}
      </div>
    );
  const menu = data.menu;
  return (
    <div className="ordering-experience">
      {demoStore && (
        <div className="demo-tools">
          <span>
            <b>Practice mode</b> · Sample menu. No real order or charge.
          </span>
          <button
            className="inline-button"
            onClick={() =>
              simulate(() => demoStore.setClosed(data.orderingOpen))
            }
          >
            {data.orderingOpen
              ? "Preview ordering cutoff"
              : "Reopen demo ordering"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {activeOrder ? (
        <section className="order-confirmation" aria-label="Your order">
          <p className="eyebrow">
            {activeOrder.status === "Fulfilled"
              ? "ENJOY YOUR LUNCH"
              : "YOUR LUNCH IS ON ITS WAY"}
          </p>
          <h2>
            {activeOrder.status === "Ordered"
              ? "You’re on the list."
              : activeOrder.status === "Preparing"
                ? "A little kitchen magic."
                : activeOrder.status === "Ready for Pickup"
                  ? "Your lunch is ready."
                  : "All picked up."}
          </h2>
          <p className="order-number">{activeOrder.number}</p>
          <ol className="order-progress" aria-label="Order progress">
            {ORDER_STATUSES.map((status, i) => (
              <li
                key={status}
                className={
                  i <= ORDER_STATUSES.indexOf(activeOrder.status)
                    ? "reached"
                    : ""
                }
                aria-current={
                  status === activeOrder.status ? "step" : undefined
                }
              >
                <span>{i + 1}</span>
                {status}
              </li>
            ))}
          </ol>
          <div className="order-detail">
            <h3>Your exact selections</h3>
            {activeOrder.items.map((item) => (
              <p key={item.category}>
                <span>{item.category}</span>
                <b>{item.name}</b>
              </p>
            ))}
            <p className="order-total">
              <span>Complete adult lunch · tax included</span>
              <b>{money(activeOrder.priceCents)}</b>
            </p>
          </div>
          <p className="hint">
            Payment happens separately at the district POS when you pick up.
            This website does not collect payment.
          </p>
          {demoStore && activeOrder.status !== "Fulfilled" && (
            <div className="demo-actions">
              {activeOrder.status !== "Ready for Pickup" ? (
                <button
                  className="outline full"
                  onClick={() =>
                    simulate(() => demoStore.advance(activeOrder.id))
                  }
                >
                  {activeOrder.status === "Ordered"
                    ? "Demo: kitchen starts preparing"
                    : "Demo: lunch is ready"}
                </button>
              ) : (
                <button
                  className="primary full"
                  onClick={() => {
                    setScan(true);
                    setError("");
                  }}
                >
                  Scan my demo lunch
                </button>
              )}
            </div>
          )}
          {scan && activeOrder.status === "Ready for Pickup" && (
            <section className="scan-demo">
              <h3>Pickup scan preview</h3>
              <p>
                The real pickup flow checks the QR on the lunch against the
                signed-in faculty account. Try a matching or mismatched demo
                ticket.
              </p>
              <button
                className="primary"
                onClick={() =>
                  simulate(() => {
                    demoStore.fulfill(activeOrder.id, true);
                    setScan(false);
                  })
                }
              >
                Use my matching ticket
              </button>
              <button
                className="outline"
                onClick={() =>
                  simulate(() => demoStore.fulfill(activeOrder.id, false))
                }
              >
                Try another teacher’s ticket
              </button>
            </section>
          )}
          {activeOrder.status === "Fulfilled" && demoStore && (
            <div className="message success">
              <b>Next: present your district POS QR.</b>
              <p>
                This demo stops before displaying a real employee POS code.
                Fulfilled means collected; payment is handled separately.
              </p>
            </div>
          )}
          {!demoStore && activeOrder.status === "Ready for Pickup" && (
            <p className="message neutral">
              Your order is ready. Camera pickup verification will be available
              after the pickup phase is connected. Cafeteria staff can help with
              pickup.
            </p>
          )}
          <button
            className="inline-button order-back"
            onClick={() => {
              setActiveOrder(null);
              setScan(false);
              setError("");
            }}
          >
            Back to today’s lunch
          </button>
        </section>
      ) : review && menu ? (
        <section className="order-confirmation">
          <p className="eyebrow">ONE LAST LOOK</p>
          <h2>That’s a good lunch.</h2>
          <p>
            Check your selections before sending your order to the cafeteria.
          </p>
          <div className="order-detail">
            {categories.map(([key]) => (
              <p key={key}>
                <span>{key}</span>
                <b>
                  {
                    menu.options.find((item) => item.id === selections[key])
                      ?.name
                  }
                </b>
              </p>
            ))}
            <p className="order-total">
              <span>Complete adult lunch · tax included</span>
              <b>{money(menu.priceCents)}</b>
            </p>
          </div>
          <p className="hint">
            Your order is accepted automatically. Pay at the district POS when
            you collect it.
          </p>
          <button
            className="primary full"
            disabled={busy || !data.orderingOpen}
            onClick={place}
          >
            {busy
              ? "Sending your order…"
              : demoStore
                ? "Place demo order"
                : "Place lunch order"}
          </button>
          <button
            className="inline-button order-back"
            disabled={busy}
            onClick={() => setReview(false)}
          >
            Edit my selections
          </button>
        </section>
      ) : (
        <div className="cafe-menu-board">
          <div className="menu-heading">
            <div className="menu-board-brand">
              <img src="/spark-192.png" alt="" width="56" height="56" />
              <div>
                <p className="eyebrow">TODAY’S LUNCH · {data.serviceDate}</p>
                <h2>
                  CAFÉ LA <span>EXPRESS</span>
                </h2>
                <p className="menu-board-tagline">
                  YOUR CAMPUS CAFÉ · BY CAFELA
                </p>
              </div>
            </div>
            {menu && (
              <div className="meal-price">
                <b>{money(menu.priceCents)}</b>
                <span>Complete lunch · tax included</span>
              </div>
            )}
          </div>
          {!data.orderingOpen && (
            <div className="message neutral">
              <b>{data.reason || "Ordering is not open right now."}</b>
              {data.nextOpening && <p>Ordering opens {data.nextOpening}.</p>}
            </div>
          )}
          {!menu ? (
            <div className="ordering-panel">
              <h3>Your menu is on its way.</h3>
              <p>
                Today’s choices will appear after your cafeteria publishes the
                menu.
              </p>
            </div>
          ) : (
            <>
              <p className="menu-explanation">
                One entrée, one fruit, one vegetable, and one milk. Pick your
                favorites below.
              </p>
              {data.orderingOpen && data.cutoffLabel && (
                <p className="cutoff-note">
                  Order by {data.cutoffLabel} · Pacific time
                </p>
              )}
              {categories.map(([category, title], index) => (
                <fieldset
                  key={category}
                  disabled={!data.orderingOpen || busy}
                  className={
                    "menu-component" +
                    (category === "entree" ? " entree-component" : "")
                  }
                >
                  <legend>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {title}
                  </legend>
                  <div className="menu-options">
                    {menu.options
                      .filter((item) => item.category === category)
                      .map((item) => (
                        <label
                          className={
                            "menu-choice" +
                            (category === "entree" ? " entree-choice" : "") +
                            (selections[category] === item.id
                              ? " selected"
                              : "")
                          }
                          key={item.id}
                        >
                          {category === "entree" && item.imageUrl && (
                            <span className="menu-photo-frame">
                              <img
                                src={item.imageUrl}
                                alt=""
                                width="1200"
                                height="800"
                                loading="lazy"
                              />
                            </span>
                          )}
                          <input
                            type="radio"
                            name={category}
                            value={item.id}
                            checked={selections[category] === item.id}
                            onChange={() => choose(category, item.id)}
                          />
                          <span className="menu-choice-copy">
                            <b>{item.name}</b>
                            {item.description && (
                              <small>{item.description}</small>
                            )}
                          </span>
                          {category === "entree" && (
                            <span className="entree-card-footer">
                              {selections[category] === item.id
                                ? "Selected for your lunch"
                                : "Choose this entrée"}
                              <span aria-hidden="true">
                                {selections[category] === item.id ? "✓" : "+"}
                              </span>
                            </span>
                          )}
                          <span className="choice-check" aria-hidden="true">
                            ✓
                          </span>
                        </label>
                      ))}
                  </div>
                </fieldset>
              ))}
              {menu.options.some((item) => item.imageUrl) && (
                <p className="photo-note">
                  Sample menu photos for this demo. Actual meals may vary.
                </p>
              )}
              <div className="review-order-bar">
                <span>
                  {complete
                    ? "Your complete lunch is ready to review."
                    : "Choose one option in each section."}
                </span>
                <button
                  className="primary"
                  disabled={!complete || !data.orderingOpen}
                  onClick={() => {
                    setReview(true);
                    setError("");
                  }}
                >
                  Review my lunch →
                </button>
              </div>
              <p className="menu-board-footer">
                A GOOD LUNCH MAKES A GOOD DAY. <span>✦</span> CAFE LA EXPRESS
              </p>
            </>
          )}
          {data.orders?.length > 0 && (
            <section className="my-orders">
              <h3>My orders today</h3>
              {data.orders.map((order) => (
                <button
                  className="order-row"
                  key={order.id}
                  onClick={() => {
                    setActiveOrder(order);
                    setError("");
                  }}
                >
                  <b>{order.number}</b>
                  <span>{order.status}</span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
