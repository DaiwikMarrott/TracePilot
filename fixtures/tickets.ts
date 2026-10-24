import type { Fixture } from "../shared/types";

// Synthetic support tickets. The eight "dev" cases are used while iterating on
// prompts; the four "holdout" cases are reserved for the final evaluation and
// should not be looked at while tuning prompt wording.
export const TICKETS: Fixture[] = [
  {
    id: "T01",
    split: "dev",
    ticket: {
      subject: "Charged twice for March",
      body: "My card statement shows two charges of $49 for the Pro plan on March 3rd. I only have one workspace. Please refund the duplicate.",
    },
    expected: { category: "billing", urgency: "medium" },
  },
  {
    id: "T02",
    split: "dev",
    ticket: {
      subject: "Locked out after enabling 2FA",
      body: "I turned on two-factor authentication yesterday and lost my phone. Now I can't sign in at all and I have a client demo in two hours.",
    },
    expected: { category: "account_access", urgency: "high" },
  },
  {
    id: "T03",
    split: "dev",
    ticket: {
      subject: "Export to CSV produces empty file",
      body: "When I export the Reports table to CSV the download completes but the file only has the header row. This started after Tuesday's update. Not blocking us yet, we copy-paste for now.",
    },
    expected: { category: "technical_support", urgency: "medium" },
  },
  {
    id: "T04",
    split: "dev",
    ticket: {
      subject: "Do you have a nonprofit discount?",
      body: "We're a small food bank evaluating your product for next year. Is there a nonprofit or education discount?",
    },
    expected: { category: "billing", urgency: "low" },
  },
  {
    id: "T05",
    split: "dev",
    ticket: {
      subject: "API returning 500 for every request — production down",
      body: "Since 09:40 UTC every call to /v2/orders returns HTTP 500. Our checkout is completely down for all customers.",
    },
    expected: { category: "technical_support", urgency: "high" },
  },
  {
    id: "T06",
    split: "dev",
    ticket: {
      subject: "Where can I find your office hours?",
      body: "Hi, just curious what time zone your support team works in and whether you're open on weekends.",
    },
    expected: { category: "general_inquiry", urgency: "low" },
  },
  {
    id: "T07",
    split: "dev",
    ticket: {
      subject: "Password reset email never arrives",
      body: "I've requested a password reset three times today and nothing shows up, not even in spam. I can still use the mobile app since I'm logged in there.",
    },
    expected: { category: "account_access", urgency: "medium" },
  },
  {
    id: "T08",
    split: "dev",
    ticket: {
      subject: "Invoice shows wrong company name",
      body: "Our invoices still list our old company name. Finance needs corrected invoices before our audit at the end of the quarter, about six weeks away.",
    },
    expected: { category: "billing", urgency: "low" },
  },
  {
    id: "T09",
    split: "holdout",
    ticket: {
      subject: "Former employee still has admin access",
      body: "A contractor we let go this morning can still log in as an admin on our workspace. I don't see how to remove them. Please help urgently.",
    },
    expected: { category: "account_access", urgency: "high" },
  },
  {
    id: "T10",
    split: "holdout",
    ticket: {
      subject: "Card declined on renewal, account suspended",
      body: "Our annual renewal failed because the card expired, and now the whole team is locked out of the dashboard. I've updated the card but it's still suspended.",
    },
    expected: { category: "billing", urgency: "high" },
  },
  {
    id: "T11",
    split: "holdout",
    ticket: {
      subject: "Dark mode toggle doesn't persist",
      body: "Every time I reload the page dark mode switches back to light. Minor annoyance, not urgent.",
    },
    expected: { category: "technical_support", urgency: "low" },
  },
  {
    id: "T12",
    split: "holdout",
    ticket: {
      subject: "Partnership question",
      body: "I run a consultancy and would like to know if you have a reseller or referral partner program.",
    },
    expected: { category: "general_inquiry", urgency: "low" },
  },
];
