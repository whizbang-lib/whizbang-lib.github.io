---
title: Body Offloads
order: 9
---

# Body Offloads (Claim-Check Pattern)

When a serialized message body exceeds the wire-message ceiling of the destination transport (e.g., Azure Service Bus Standard's 256 KB hard limit), Whizbang's body offload feature transparently uploads the body to a registered `IMessageBodyStore` and substitutes a small claim envelope on the wire. The receiver detects the claim, downloads the body, verifies its SHA-256 hash, and rehydrates the original message before invoking receptors.
