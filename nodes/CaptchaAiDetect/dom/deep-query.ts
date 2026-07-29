/**
 * Shadow-DOM-piercing query helpers, ported from
 * `detector.ts:2780-2819` (`querySelectorAllDeep` / `querySelectorDeep`).
 *
 * These run inside the browser page (via Playwright `frame.evaluate`), never
 * in Node. They are written as plain function declarations with no
 * references to anything outside their own body, because Playwright ships
 * a function to the browser by taking `fn.toString()` - any reference to an
 * outer closure variable or another module's export would be `undefined` at
 * runtime in the page. See `dom/compose.ts` for how these are combined with
 * detector logic into a single script sent to `frame.evaluate`.
 */

/**
 * Query a selector across `root` and every open shadow root nested beneath
 * it. Closed shadow roots are only reachable if the `attachShadow` patch from
 * `hooks/init-script.ts` has widened them to `open` first (top frame only).
 */
export function querySelectorAllDeep(selector: string, root?: Document | Element | ShadowRoot): Element[] {
	const startRoot: Document | Element | ShadowRoot = root || document;
	const results: Element[] = [];
	const seenRoots = new Set<Document | Element | ShadowRoot>();
	const seenElements = new Set<Element>();

	const visit = (currentRoot: Document | Element | ShadowRoot) => {
		if (seenRoots.has(currentRoot)) return;
		seenRoots.add(currentRoot);

		try {
			const matches = currentRoot.querySelectorAll(selector);
			for (let i = 0; i < matches.length; i++) {
				const match = matches[i];
				if (!seenElements.has(match)) {
					seenElements.add(match);
					results.push(match);
				}
			}
		} catch {
			// Ignore invalid selectors / inaccessible roots.
		}

		try {
			const all = currentRoot.querySelectorAll('*');
			for (let i = 0; i < all.length; i++) {
				const el = all[i] as Element & { shadowRoot?: ShadowRoot | null };
				if (el.shadowRoot) {
					visit(el.shadowRoot);
				}
			}
		} catch {
			// Ignore.
		}
	};

	visit(startRoot);
	return results;
}

export function querySelectorDeep(selector: string, root?: Document | Element | ShadowRoot): Element | null {
	const startRoot: Document | Element | ShadowRoot = root || document;
	const seenRoots = new Set<Document | Element | ShadowRoot>();

	const visit = (currentRoot: Document | Element | ShadowRoot): Element | null => {
		if (seenRoots.has(currentRoot)) return null;
		seenRoots.add(currentRoot);

		try {
			const match = currentRoot.querySelector(selector);
			if (match) return match;
		} catch {
			// Ignore invalid selectors / inaccessible roots.
		}

		try {
			const all = currentRoot.querySelectorAll('*');
			for (let i = 0; i < all.length; i++) {
				const el = all[i] as Element & { shadowRoot?: ShadowRoot | null };
				if (el.shadowRoot) {
					const nested = visit(el.shadowRoot);
					if (nested) return nested;
				}
			}
		} catch {
			// Ignore.
		}
		return null;
	};

	return visit(startRoot);
}
