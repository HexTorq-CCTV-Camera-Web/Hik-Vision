# Existing Linux base-image recipes

These are unchanged copies from the earlier Wine experiment, bundled so the
Linux pilot source no longer needs that experiment folder.

From the Linux application root, the historical build order is:

```sh
docker build -t mohan-cam-wine-test:local -f runtime-build/Dockerfile runtime-build
docker build -t mohan-cam-playback:local -f runtime-build/Dockerfile.playback runtime-build
docker build -t mohan-cam-service:local -f Dockerfile.service .
```

These commands are documentation only; no images were built during separation.
The image recipes download their external runtime prerequisites. They do not
supply the vendor SDK, private grants, configured Wine prefix or persistent data.
Existing deployment scripts expect the prior mounts and Linux user identity.
The historical playback recipe pins PyAV 18.1.0; native/requirements.txt lists
19.0.1. Both are preserved as found; this organization task does not upgrade or
qualify a new image. Reconcile that existing difference before a future release.
