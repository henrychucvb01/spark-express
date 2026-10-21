import React from "react";
import OrderingExperience from "./OrderingExperience";
async function request(body) {
  const response = await fetch("/api/ordering", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || "Your lunch service is temporarily unavailable.",
    );
  return data;
}
const load = () => request();
const place = (body) => request(body);
export default function FacultyOrdering() {
  return <OrderingExperience load={load} placeOrder={place} />;
}
