Recorded from the appliances on 25.10.2026 (read-only, see docs/superpowers/specs/2026-10-25-upnp-design.md, annex A):

- `*/description.xml`, `ddd.xml` and the AVTransport SCPDs are the documents as served, fetched with GET.
- `Get*.xml` are the idle answers of annex A.5 and A.6 (values as recorded), in a SOAP envelope written again.

The fake appliance (`../fakeRenderer.ts`) serves them, the absolute URLs pointed at itself.
