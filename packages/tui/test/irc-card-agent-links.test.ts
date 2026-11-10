import { beforeAll, describe, expect, it, vi } from "bun:test";
import type { CustomMessage } from "@oh-my-pi/pi-tui/chat/messages";
import { buildIrcMessageCard, buildParentIrcMessageCard } from "@oh-my-pi/pi-tui/chat/transcript-render-helpers";
import { TranscriptContainer } from "@oh-my-pi/pi-tui/chrome/transcript-container";
import type { DescribeContext, NativeChild } from "@oh-my-pi/pi-tui/native/node";
import { COMPOSER_DEFAULTS, Composer } from "@oh-my-pi/pi-tui/prompt/composer";
import { initTheme, theme } from "@oh-my-pi/pi-tui/theme";
import { createIrcMessageCard } from "@oh-my-pi/pi-tui/tools/wait";
import type { Component } from "@oh-my-pi/pi-tui";
import { VirtualTerminal } from "./virtual-terminal";

beforeAll(() => {
	initTheme();
});

const collapsed = () => false;
const cx: DescribeContext = { cols: 120, reduceMotion: false, dark: true, supports: () => true, feature: () => false };

/** The agent each native link under `node` views, in document order. */
function linkedAgents(node: NativeChild | null | undefined): string[] {
	if (!node || !("k" in node)) return [];
	const click = node.p && "actions" in node.p ? node.p.actions?.click : undefined;
	const here = click?.startsWith("focus:") ? [click.slice("focus:".length)] : [];
	return [...here, ...(node.c ?? []).flatMap(linkedAgents)];
}

/** The agents a card links. */
function cardLinks(card: Component): string[] {
	return linkedAgents(card.describe?.(cx));
}

describe("IRC card agent links", () => {
	it("links the agents a card names and views the clicked one in Tern", () => {
		const onViewAgent = vi.fn();
		const relay = createIrcMessageCard(
			{ kind: "relay", from: "Scout", to: "Builder", body: "done with the parser", timestamp: Date.now() },
			collapsed,
			theme,
			onViewAgent,
		);
		expect(cardLinks(relay)).toEqual(["Scout", "Builder"]);

		relay.handleNativeEvent?.({ type: "action", key: "0/2", act: "focus:Builder", mods: [] });
		expect(onViewAgent).toHaveBeenCalledWith("Builder");
		// Only an agent the card links is viewed.
		relay.handleNativeEvent?.({ type: "action", key: "0/2", act: "focus:Intruder", mods: [] });
		expect(onViewAgent).toHaveBeenCalledTimes(1);

		const parent = buildParentIrcMessageCard({ from: "Main", body: "rebase first" }, Date.now(), collapsed, vi.fn());
		expect(cardLinks(parent)).toEqual(["Main"]);
		const broadcast = createIrcMessageCard({ kind: "autoreply", to: "all", body: "ok" }, collapsed, theme, vi.fn());
		expect(cardLinks(broadcast)).toEqual([]);
		// No viewer (a transcript viewer, a collab guest): nothing is a link.
		const unlinked = createIrcMessageCard({ kind: "incoming", from: "Scout", body: "hi" }, collapsed, theme);
		expect(cardLinks(unlinked)).toEqual([]);
	});

	it("makes a live card a click-to-focus target for its subagents in a plain terminal", () => {
		const term = new VirtualTerminal(80, 24);
		const composer = new Composer({ terminal: term, preferences: { ...COMPOSER_DEFAULTS, quiet: true } });
		composer.start();
		try {
			const relay: CustomMessage = {
				role: "custom",
				customType: "irc:relay",
				content: "parser done",
				details: { from: "Scout", to: "Builder", body: "parser done" },
				display: true,
				timestamp: Date.now() - 3000,
			};
			const transcript = new TranscriptContainer();
			transcript.addChild(buildIrcMessageCard(relay, collapsed, vi.fn()));
			transcript.addChild(
				buildParentIrcMessageCard({ from: "Main", body: "rebase first" }, Date.now(), collapsed, vi.fn()),
			);
			composer.setRuntimeChildren([transcript]);
			const rows = composer.renderFrame({ columns: 80, rows: 24 }).viewport.map(row => Bun.stripANSI(row));
			const relayRow = rows.findIndex(row => row.includes("Scout") && row.includes("Builder"));
			const parentRow = rows.findIndex(row => row.includes("Main"));
			expect(relayRow).toBeGreaterThanOrEqual(0);
			expect(composer.viewportClickCandidates(relayRow)).toEqual(["Scout", "Builder"]);
			// The main session is the view itself: a click there would focus nothing.
			expect(parentRow).toBeGreaterThanOrEqual(0);
			expect(composer.viewportClickCandidates(parentRow)).toEqual([]);
		} finally {
			composer.stop();
		}
	});
});
