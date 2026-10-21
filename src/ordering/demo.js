export const DEMO_NAME = "Demo Faculty";
export const DEMO_PIN = "246810";
export const ORDER_STATUSES = [
  "Ordered",
  "Preparing",
  "Ready for Pickup",
  "Fulfilled",
];
export function createDemoStore(now = () => new Date()) {
  let orders = [],
    closed = false,
    sequence = 0;
  const date = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now());
  const menu = () => ({
    id: "demo-menu",
    revision: 1,
    serviceDate: date(),
    priceCents: 684,
    options: [
      {
        id: "entree-chicken",
        category: "entree",
        name: "Herb-roasted chicken with rice",
        description: "A warm, satisfying café lunch.",
        imageUrl: "/menu-photos/chicken-rice.webp",
      },
      {
        id: "entree-salad",
        category: "entree",
        name: "Garden salad with chickpeas",
        description: "Crisp greens, chickpeas, and seasonal vegetables.",
        imageUrl: "/menu-photos/chickpea-salad.webp",
      },
      { id: "fruit-apple", category: "fruit", name: "Fresh apple" },
      { id: "fruit-orange", category: "fruit", name: "Orange wedges" },
      { id: "veg-broccoli", category: "vegetable", name: "Steamed broccoli" },
      { id: "veg-carrots", category: "vegetable", name: "Baby carrots" },
      { id: "milk-white", category: "milk", name: "Low-fat white milk" },
      { id: "milk-nonfat", category: "milk", name: "Nonfat white milk" },
    ],
  });
  return {
    async load() {
      return {
        available: true,
        orderingOpen: !closed,
        reason: closed ? "Ordering is closed for today." : "",
        menu: menu(),
        serviceDate: date(),
        cutoffLabel: "10:00 AM",
        nextOpening: closed ? "Tomorrow at 6:30 AM (demo schedule)" : null,
        orders: structuredClone(orders),
      };
    },
    async place({ requestId, selections }) {
      const previous = orders.find((x) => x.requestId === requestId);
      if (previous) return structuredClone(previous);
      if (closed) throw new Error("Ordering is closed for today.");
      const options = menu().options;
      const items = ["entree", "fruit", "vegetable", "milk"].map((category) => {
        const item = options.find(
          (x) => x.id === selections[category] && x.category === category,
        );
        if (!item) throw new Error("Choose one item from each meal component.");
        return { category, name: item.name, optionId: item.id };
      });
      sequence++;
      const order = {
        id: `demo-order-${sequence}`,
        requestId,
        number: `DEMO-${date().replaceAll("-", "")}-${String(sequence).padStart(3, "0")}`,
        serviceDate: date(),
        status: "Ordered",
        items,
        priceCents: 684,
        submittedAt: now().toISOString(),
      };
      orders.unshift(order);
      return structuredClone(order);
    },
    advance(id) {
      const order = orders.find((x) => x.id === id);
      if (order && ORDER_STATUSES.indexOf(order.status) < 2)
        order.status = ORDER_STATUSES[ORDER_STATUSES.indexOf(order.status) + 1];
    },
    fulfill(id, match) {
      const order = orders.find((x) => x.id === id);
      if (!match)
        throw new Error(
          "This lunch belongs to another faculty member. Your order has not been fulfilled.",
        );
      if (!order || order.status !== "Ready for Pickup")
        throw new Error("Wait until your demo lunch is ready for pickup.");
      order.status = "Fulfilled";
    },
    setClosed(value) {
      closed = value;
    },
    reset() {
      orders = [];
      closed = false;
      sequence = 0;
    },
  };
}
