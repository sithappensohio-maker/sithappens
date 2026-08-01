import { buildNeedsAttention } from "./PortalNeedsAttentionCard";

const dog = { id: "dog-1", name: "Lexi" };

test("an incomplete setup step wins over an unread message — setup lock still blocks everything else", () => {
  // This is the actual component that owns "Finish your setup" priority
  // (see PortalEngagementHub.jsx's own comment: the compact card there
  // intentionally never duplicates this message). Even with an unread
  // message AND a pending booking present, an incomplete required setup
  // step must still be shown first.
  const result = buildNeedsAttention({
    setupStatus: { steps: [{ id: "client_info", status: "incomplete", action_label: "Update Contact Info" }] },
    dogs: [dog],
    bookings: [{ id: "b1", status: "pending", date: "2099-01-01", service_type: "daycare", dog_name: "Lexi" }],
    messagesUnread: 3,
  });
  expect(result.kind).toBe("setup");
  expect(result.actionTarget).toBe("profile");
});

test("setup steps are enforced in order — dog info blocks before waiver/vaccines even once contact info is done", () => {
  const result = buildNeedsAttention({
    setupStatus: {
      steps: [
        { id: "client_info", status: "complete" },
        { id: "dog_info", status: "incomplete", missing: ["Breed"] },
        { id: "waiver", status: "incomplete" },
      ],
    },
    dogs: [dog],
  });
  expect(result.kind).toBe("setup");
  expect(result.actionTarget).toBe("dogs");
});

test("once every setup step is complete, a real unread message is shown instead", () => {
  const result = buildNeedsAttention({
    setupStatus: {
      steps: [
        { id: "client_info", status: "complete" },
        { id: "emergency", status: "complete" },
        { id: "dog_info", status: "complete" },
        { id: "waiver", status: "complete" },
        { id: "vaccines", status: "complete", missing: [] },
      ],
    },
    dogs: [dog],
    messagesUnread: 1,
  });
  expect(result.kind).toBe("messages");
});
