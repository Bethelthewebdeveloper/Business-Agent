import unittest
from agent import respond

B = {"name": "Demo Shop", "currency": "NGN", "greeting": "Welcome!", "hours": "Mon-Sat 9-5", "delivery_info": "Lagos only", "payment_info": None, "policies": None,
     "products": [{"name": "Red Sneakers", "price": 15000, "variations": ["40", "41", "42"], "available": True, "description": ""},
                  {"name": "Tote Bag", "price": 5000, "variations": [], "available": True, "description": ""}],
     "faqs": [{"question": "Do you offer gift wrapping?", "answer": "Yes, free gift wrapping."}]}


def say(text, state=None, ch="website", cust=None):
    return respond({"business": B, "message": text, "state": state or {}, "channel": ch, "customer": cust or {}})


class T(unittest.TestCase):
    def test_price_uses_business_data(self):
        r = say("how much are the sneakers?"); self.assertIn("15,000.00", r["reply"]); self.assertEqual(r["actions"][0]["type"], "interest")
    def test_hours_and_missing_payment(self):
        self.assertIn("Mon-Sat", say("when are you open")["reply"])
        r = say("how can I pay?"); self.assertEqual(r["actions"][0]["type"], "handoff"); self.assertIn("won't guess", r["reply"])
    def test_faq(self):
        self.assertIn("gift wrapping", say("do you do gift wrapping")["reply"])
    def test_order_flow(self):
        s = {}
        for msg in ["I want 2 red sneakers", "42", "Ada", "12 Allen Avenue, Ikeja", "08012345678", "none"]:
            r = say(msg, s); s = r["state"]
        self.assertEqual(s["step"], "confirm"); self.assertIn("Quantity: 2", r["reply"])
        r = say("yes", s); self.assertEqual(r["actions"][0]["type"], "order")
        o = r["actions"][0]["order"]; self.assertEqual(o["items"][0]["quantity"], 2); self.assertNotIn("flow", r["state"])
    def test_validation_and_cancel(self):
        r = say("I want a tote bag"); r = say("lots", r["state"]); self.assertIn("quantity", r["reply"].lower())
        r = say("cancel", r["state"]); self.assertEqual(r["intent"], "order_cancelled")
    def test_whatsapp_skips_phone(self):
        s = {}
        for msg in ["order tote bag 1", "Bola", "5 Marina, Lagos"]:
            r = say(msg, s, "whatsapp", {"phone": "2348000000000"}); s = r["state"]
        self.assertEqual(s["step"], "ask_notes")
    def test_human(self):
        self.assertEqual(say("I want to speak to a human")["actions"][0]["reason"], "human_requested")

if __name__ == "__main__":
    unittest.main()
