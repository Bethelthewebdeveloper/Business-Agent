"""Local rule-based business agent. NOT a language model: it uses keyword intent matching,
a persisted conversation state machine, and only the business knowledge passed in.
Structured so a hosted model could later replace `respond()` behind the same input/output contract."""
import re

NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "a": 1, "an": 1}
STOP = set("a an the is are do you i me my to for of in on and or it your we can what how have any there this that with at be please about tell".split())

INTENTS = [
    ("human", r"\b(human|real person|speak to|talk to|representative|manager|owner|complaint|complain|call me)\b"),
    ("order_status", r"\b(order status|status of (my|the) order|my order|track|where is my order|order update)\b"),
    ("order", r"\b(order|buy|purchase|i want|i'?d like|i would like|get me|place an order)\b"),
    ("price", r"\b(price|prices|cost|how much|pricing)\b"),
    ("availability", r"\b(available|availability|in stock|stock|do you have|have any)\b"),
    ("variation", r"\b(size|sizes|colou?rs?|variations?|flavou?rs?|options|types?)\b"),
    ("delivery", r"\b(deliver|delivery|shipping|ship|dispatch)\b"),
    ("hours", r"\b(open|opening|hours|close|closing|when are you)\b"),
    ("payment", r"\b(pay|payment|transfer|cash|card|account number|bank)\b"),
    ("policy", r"\b(policy|policies|refund|return|returns|warranty|exchange)\b"),
    ("catalog", r"\b(products|catalog|catalogue|menu|what do you (sell|offer)|services|price list)\b"),
]
GREETING = re.compile(r"^\s*(hi|hello|hey|hola|howdy|good (morning|afternoon|evening))\b[\s!.,?]*$", re.I)
CANCEL = re.compile(r"\b(cancel|stop|never ?mind|start over|forget it)\b", re.I)
YES = re.compile(r"^\s*(yes|y|yeah|yep|confirm|confirmed|ok|okay|correct|sure|go ahead)\b", re.I)
NO = re.compile(r"^\s*(no|n|nope|wrong|incorrect)\b", re.I)


def toks(text):
    out = []
    for w in re.sub(r"[^a-z0-9\s]", " ", text.lower()).split():
        if w not in STOP:
            out.append(w[:-1] if len(w) > 3 and w.endswith("s") else w)
    return out


def money(b, amount):
    return f"{b.get('currency') or ''} {amount:,.2f}".strip()


def find_product(text, products):
    low = text.lower()
    t = set(toks(text))
    best, best_score = None, 0.0
    for p in products:
        name = p["name"].lower()
        if name in low:
            score = 2.0 + len(name) / 100
        else:
            pt = set(toks(p["name"]))
            if not pt:
                continue
            hits = len(pt & t)
            score = hits / len(pt) if hits and hits / len(pt) >= 0.5 else 0
        if score > best_score:
            best, best_score = p, score
    return best


def find_variation(text, product):
    low = text.lower()
    for v in product.get("variations") or []:
        if v.lower() in low:
            return v
    return None


def parse_qty(text):
    m = re.search(r"\b(\d{1,3})\b", text)
    if m and 1 <= int(m.group(1)) <= 999:
        return int(m.group(1))
    for w in re.findall(r"[a-z]+", text.lower()):
        if w in NUM_WORDS and w not in ("a", "an"):
            return NUM_WORDS[w]
    return None


def faq_match(text, faqs):
    t = set(toks(text))
    best, best_hits = None, 0
    for f in faqs:
        ft = set(toks(f["question"]))
        hits = len(ft & t)
        if hits >= 2 or (hits == 1 and len(ft) <= 2 and len(t) <= 3):
            if hits > best_hits:
                best, best_hits = f, hits
    return best


def classify(text):
    if GREETING.match(text):
        return "greeting"
    low = text.lower()
    for name, pat in INTENTS:
        if re.search(pat, low):
            return name
    return None


def product_line(b, p):
    s = f"{p['name']} - {money(b, p['price'])}"
    if p.get("variations"):
        s += f" (options: {', '.join(p['variations'])})"
    if not p.get("available", True):
        s += " [currently unavailable]"
    return s


def handoff(state, reason, question, reply):
    return {"reply": reply, "state": state, "intent": reason, "actions": [{"type": "handoff", "reason": reason, "question": question}]}


NOT_KNOWN = ("I don't have that information yet, so I won't guess. I've recorded your question for the business owner to review "
             "in their dashboard. You can also ask me about products, prices, delivery, opening hours or placing an order.")


def order_summary(b, d):
    p = d["product_obj"] if "product_obj" in d else None
    unit = d["unit_price"]
    lines = [f"Please check your order request:",
             f"- Item: {d['product']}" + (f" ({d['variation']})" if d.get("variation") else ""),
             f"- Quantity: {d['quantity']}",
             f"- Estimated total: {money(b, unit * d['quantity'])} (final amount is confirmed by the owner)",
             f"- Name: {d['name']}", f"- Delivery address: {d['address']}"]
    if d.get("phone"):
        lines.append(f"- Phone: {d['phone']}")
    if d.get("notes"):
        lines.append(f"- Notes: {d['notes']}")
    lines.append("Reply YES to submit this order request, or NO to cancel.")
    return "\n".join(lines)


def next_step(b, state, ctx):
    d = state["data"]
    prods = [p for p in b["products"]]
    if not d.get("product"):
        return "ask_product", "Which product would you like to order?\n" + "\n".join("- " + product_line(b, p) for p in prods if p.get("available", True))
    p = next((x for x in prods if x["name"] == d["product"]), None)
    if not d.get("quantity"):
        return "ask_quantity", f"How many {d['product']} would you like?"
    if p and p.get("variations") and not d.get("variation"):
        return "ask_variation", f"Which option would you like for {d['product']}? {', '.join(p['variations'])}"
    if not d.get("name"):
        return "ask_name", "What name should the order be under?"
    if not d.get("address"):
        return "ask_address", "What is the delivery address?"
    if not d.get("phone") and not ctx.get("phone"):
        return "ask_phone", "What phone number can the business reach you on?"
    if "notes" not in d:
        return "ask_notes", "Any additional instructions? (Reply NONE if there are none)"
    return "confirm", order_summary(b, d)


def prefill_order(b, state, text, ctx):
    d = state["data"]
    p = find_product(text, b["products"])
    if p and p.get("available", True):
        d["product"], d["unit_price"] = p["name"], p["price"]
        v = find_variation(text, p)
        if v:
            d["variation"] = v
        q = parse_qty(text)
        if q:
            d["quantity"] = q
    if ctx.get("name"):
        d["name"] = ctx["name"]
    if ctx.get("phone"):
        d["phone"] = ctx["phone"]


def start_order(b, state, text, ctx):
    state["flow"], state["data"] = "order", {}
    prefill_order(b, state, text, ctx)
    step, reply = next_step(b, state, ctx)
    state["step"] = step
    return {"reply": reply, "state": state, "intent": "order", "actions": []}


def continue_order(b, state, text, ctx):
    d, step, prods = state["data"], state.get("step"), b["products"]
    intent = "order"
    if CANCEL.search(text):
        state.pop("flow", None); state.pop("step", None); state.pop("data", None)
        return {"reply": "No problem, I've cancelled that order request. Nothing was saved.", "state": state, "intent": "order_cancelled", "actions": []}
    if classify(text) == "human":
        state.pop("flow", None); state.pop("step", None); state.pop("data", None)
        return handoff(state, "human_requested", text, "Understood. I've asked the business owner to review this conversation in their dashboard. Your unfinished order request was not saved.")
    err = None
    if step == "ask_product":
        p = find_product(text, prods)
        if p and p.get("available", True):
            d["product"], d["unit_price"] = p["name"], p["price"]
            v = find_variation(text, p)
            if v: d["variation"] = v
        else:
            err = "I couldn't match that to an available product."
    elif step == "ask_quantity":
        q = parse_qty(text)
        if q: d["quantity"] = q
        else: err = "Please give a quantity as a number between 1 and 999."
    elif step == "ask_variation":
        p = next(x for x in prods if x["name"] == d["product"])
        v = find_variation(text, p)
        if v: d["variation"] = v
        else: err = "That isn't one of the available options."
    elif step == "ask_name":
        n = text.strip()
        if 2 <= len(n) <= 60: d["name"] = n
        else: err = "Please enter a name (2-60 characters)."
    elif step == "ask_address":
        a = text.strip()
        if 6 <= len(a) <= 250: d["address"] = a
        else: err = "Please enter a full delivery address."
    elif step == "ask_phone":
        digits = re.sub(r"\D", "", text)
        if 7 <= len(digits) <= 15: d["phone"] = ("+" if text.strip().startswith("+") else "") + digits
        else: err = "Please enter a valid phone number (7-15 digits)."
    elif step == "ask_notes":
        d["notes"] = "" if re.match(r"^\s*(none|no|nil|skip|nothing|n/a)\b", text, re.I) else text.strip()[:500]
    elif step == "confirm":
        if YES.match(text):
            item = {"product": d["product"], "quantity": d["quantity"], "variation": d.get("variation"), "unit_price": d["unit_price"]}
            order = {"customer_name": d["name"], "phone": d.get("phone") or ctx.get("phone"), "address": d["address"], "notes": d.get("notes", ""), "items": [item]}
            state.pop("flow", None); state.pop("step", None); state.pop("data", None)
            return {"reply": "Thank you! Your order request #{order_id} has been saved and is waiting for the owner's review. "
                             "It is not confirmed or paid yet; the owner will follow up with you.",
                    "state": state, "intent": "order_submitted", "actions": [{"type": "order", "order": order}]}
        if NO.match(text):
            state.pop("flow", None); state.pop("step", None); state.pop("data", None)
            return {"reply": "Okay, I've cancelled that order request. Nothing was saved.", "state": state, "intent": "order_cancelled", "actions": []}
        return {"reply": "Please reply YES to submit this order request, or NO to cancel.\n\n" + order_summary(b, d), "state": state, "intent": intent, "actions": []}
    if err:
        _, prompt = next_step(b, state, ctx)
        return {"reply": f"{err}\n{prompt}", "state": state, "intent": intent, "actions": []}
    nxt, reply = next_step(b, state, ctx)
    state["step"] = nxt
    return {"reply": reply, "state": state, "intent": intent, "actions": []}


def respond(payload):
    b = payload["business"]
    text = (payload.get("message") or "").strip()
    state = payload.get("state") or {}
    ctx = payload.get("customer") or {}
    ctx["channel"] = payload.get("channel")
    b.setdefault("products", []); b.setdefault("faqs", [])
    state.setdefault("interests", [])
    if not text:
        return {"reply": "Sorry, I can only read text messages right now. Could you type your question?", "state": state, "intent": "unsupported", "actions": []}
    if state.get("flow") == "order":
        return continue_order(b, state, text, ctx)

    intent = classify(text)
    prod = find_product(text, b["products"])
    actions = []
    if prod and intent in (None, "price", "availability", "variation", "catalog", "order") and prod["name"] not in state["interests"] and intent != "order":
        state["interests"].append(prod["name"])
        actions.append({"type": "interest", "product": prod["name"]})

    def done(reply, i):
        return {"reply": reply, "state": state, "intent": i, "actions": actions}

    if intent == "greeting":
        return done(b.get("greeting") or f"Hello! Welcome to {b['name']}. How can I help?", "greeting")
    if intent == "human":
        actions.append({"type": "handoff", "reason": "human_requested", "question": text})
        return done("Of course. I've asked the business owner to review this conversation in their dashboard. They will reply when they are available.", "human")
    if intent == "order_status":
        orders = ctx.get("orders") or []
        if not orders:
            return done("I can't find an order request linked to this chat. If you placed one another way, I can pass your question to the owner.", "order_status")
        o = orders[0]
        return done(f"Your most recent order request #{o['id']} is currently: {o['status']}. Payment status: {o['payment_status']}.", "order_status")
    if intent == "order" or (prod and re.search(r"\b(i want|i'?d like|buy|order)\b", text, re.I)):
        if not b["products"]:
            actions.append({"type": "handoff", "reason": "no_catalog", "question": text})
            return done("The business hasn't added products yet, so I can't take an order. I've recorded your request for the owner to review.", "order")
        r = start_order(b, state, text, ctx); r["actions"] = actions; return r
    if intent in ("price", "availability", "variation", "catalog") or prod:
        if prod:
            line = product_line(b, prod)
            if intent == "availability":
                return done(f"{prod['name']} is " + ("available." if prod.get("available", True) else "currently unavailable.") + " Would you like to order it?", "availability")
            if intent == "variation":
                if prod.get("variations"): return done(f"{prod['name']} comes in: {', '.join(prod['variations'])}.", "variation")
                return done(f"No size or variation options are listed for {prod['name']}.", "variation")
            return done(f"{line}\n{prod.get('description') or ''}\nWould you like to order it?".replace("\n\n", "\n"), "price" if intent == "price" else "product")
        if b["products"]:
            return done("Here is what we offer:\n" + "\n".join("- " + product_line(b, p) for p in b["products"]) + "\nTell me which one you'd like to order.", "catalog" if intent == "catalog" else intent)
        actions.append({"type": "handoff", "reason": "unknown_question", "question": text})
        return done(NOT_KNOWN, "unknown")
    if intent == "delivery" and b.get("delivery_info"): return done(b["delivery_info"], "delivery")
    if intent == "hours" and b.get("hours"): return done(b["hours"], "hours")
    if intent == "payment" and b.get("payment_info"): return done(b["payment_info"], "payment")
    if intent == "policy" and b.get("policies"): return done(b["policies"], "policy")
    f = faq_match(text, b["faqs"])
    if f:
        return done(f["answer"], "faq")
    actions.append({"type": "handoff", "reason": "unknown_question", "question": text})
    return done(NOT_KNOWN, "unknown")
