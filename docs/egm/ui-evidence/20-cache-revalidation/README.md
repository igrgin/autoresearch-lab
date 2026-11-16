# Configuration cache revalidation

The before capture uses the previously packaged round-3 application (combined
validation tree `d9c02b759315c9a6aa90deaf46b450d638e8c2b3`), whose configuration
implementation matches the repair baseline `c96fcf7`. It uses an isolated profile
and a synthetic objective later entered through the actual credential form.
After the host denies revalidation, the old selected objective remains visible.
The focused fixture correctly fails both cache-clearing assertions before repair.

The harness brings the native application to the foreground at 100% zoom and
captures only the visible configuration region. It neither edits images nor
modifies production styling. Earlier raw worker and capture attempts are retained
in their original evidence records. Credentials and displayed values are synthetic;
these images establish presentation, not live provider/model access.

The repaired combined package passes all 27 configuration-protection assertions.
The [after capture](after-native/snapshot-after.png) shows the withheld view after
denied revalidation; the previous selected objective is absent. See
[capture.json](capture.json) for source correlation and image hashes.
