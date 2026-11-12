# Windows VM testing — postponed

**Decision: postponed at the project owner's request on 2026-11-12.**
Resume only when the owner chooses to continue. Do not install a VM tool, create
a VM, change certificate trust or start native installation testing as part of
this documentation update. Batch 5 commercial acceptance remains open.

## Decisions from the discussion

- A disposable Windows VM is acceptable for occasional testing. It is a test
  environment, not another application feature or a permanently running server.
- Save work and close VS Code, Docker and other heavy applications before using
  it. Run one VM at a time. Stop if memory pressure makes the laptop struggle.
- Fully shut down the guest and exit the VM application after testing. Pausing
  a VM is not equivalent to shutting it down. VM files still occupy disk space;
  installed virtualization software/drivers and some background services can
  remain even while the guest is off. Temporary use is not zero host impact.
- Self-signed **code-signing** certificates are accepted for internal testing,
  with explicit certificate trust on the test account and the existing pinned
  publisher checks. They do not replace production signing or license/release
  signing keys, and are separate from HTTPS certificates.
- Internal signing engineering is implemented; a persistent test publisher key
  and trusted VM have not been established by the automated signing smoke test.
- VirtualBox's Windows x86-64 base package was suggested. Installation has **not
  been confirmed**. No Extension Pack is needed for the planned basic VM tests.

## Laptop capacity and why testing was deferred

The owner reported Windows 11 Home Single Language and 8 GB RAM. The read-only
hardware check during this discussion reported:

| Item                   | Observation                                                |
| ---------------------- | ---------------------------------------------------------- |
| Visible RAM            | About 7.8 GB                                               |
| Free RAM at that check | About 1 GB; this varies with running applications          |
| CPU                    | Intel Core i5-1135G7, 4 cores / 8 logical processors       |
| Hypervisor             | Windows reported `HypervisorPresent = True`                |
| Free disk space        | C: 34.3 GB; D: 208 GB; E: 252.1 GB; F: 43.5 GB; G: 87.2 GB |

These are dated observations, not guaranteed current capacity. CPU firmware/SLAT
flags also returned false; with a hypervisor already present, those observations
alone do **not** establish that firmware virtualization is disabled. Confirm
actual VM-tool compatibility when resuming; do not change BIOS/security settings
based only on these flags.

Later, the owner reported about 1.8 GB free and estimated that closing VS Code
could bring this to about 2.8 GB. The latter was an estimate, not a verified
measurement. A Windows 11 guest needs at least 4 GB RAM, two virtual processors
and a 64 GB virtual disk. An 8 GB host may run one guest, but performance is not
guaranteed and paging may make it slow. Earlier blanket advice against trying a
VM was too absolute; a cautious trial remains an option, not an acceptance pass.
See [Microsoft's Windows 11 VM requirements](https://learn.microsoft.com/en-us/windows/whats-new/windows-11-requirements).

Windows Home does not include the Hyper-V role, so the proposed route uses another
VM product. See [Microsoft's Hyper-V installation guidance](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v).

The original reasons for postponement were limited RAM, no disposable host/client
and the need to protect the everyday development laptop from installer service,
account, firewall and trust changes. Temporary VM use was reconsidered, then
explicitly postponed again by the owner. No requirement was waived.

## What is already verified

- The native launcher compiled and its safety checks/off-screen rendering passed.
- The owner opened the preview and confirmed the title shows
  **GST Billing — Setup & Recovery [INTERNAL TEST ONLY]**. This is a window label,
  not a task-dropdown option. No setup action is needed in that unsigned preview.
- The internal signing smoke test created an ephemeral non-exportable key,
  signed a fixture and checked rejection cases. That exact test key was deleted.
- Certificate trust changes in automated tests used `WhatIf`; real trusted
  verification and native installation were not performed on the laptop.
- Focused regression tests and checks are recorded in
  [review coverage](review-coverage.md). These do not prove reboot, power-loss,
  real scheduler/account policy or separate-client LAN acceptance.

The current code can be committed/pushed as an engineering checkpoint while
these release gates remain explicitly pending. A pushed commit is not a
commercial release or evidence that VM acceptance passed.

## Resume here when the owner is ready

1. Recheck available RAM and free space after closing heavy applications. Save
   work before the trial. Confirm which VM tools are already installed.
2. If proceeding with VirtualBox, obtain the Windows hosts/x86-64 base package
   from the [official download page](https://www.oracle.com/virtualization/technologies/vm/downloads/virtualbox-downloads.html).
   Installation changes host drivers/networking and may briefly disconnect the
   network; perform it as an explicit setup step, not silently in a project script.
3. Obtain legitimate Windows installation media and appropriate evaluation/use
   rights. Select a supported Windows 11 guest configuration (including virtual
   TPM/firmware requirements) without bypassing system requirements. Store its
   virtual disk on a drive with adequate free space, allowing room for snapshots
   and backups beyond the guest's minimum virtual disk size.
4. Try one guest with 4 GB RAM and two virtual processors. Observe actual host and
   guest behavior before starting the installer. If the laptop becomes unstable
   or unresponsive, shut down the guest and defer testing to better hardware.
5. Prepare a clean disposable snapshot and synthetic data. Keep the real billing
   database, production keys and personal files outside the test environment.
6. Follow [internal signing](internal-windows-signing.md) to create the publisher
   test key, build the real pinned maintenance runtime and sign it. The unsigned
   preview executable is not an installable runtime package. Transfer only public
   certificate material and the approved package to the guest. Explicitly approve
   trust for the intended guest account and run strict signature verification.
7. Execute and record the existing [Windows acceptance matrix](windows-deployment-checks.md):
   installation, backup, updates, interrupted recovery, certificate replacement,
   repair, reboot and preserving uninstall, including denial/failure cases. Use
   snapshots to repeat cases; retain operation evidence before reverting.
8. Arrange a separate client for the outstanding LAN/DNS/TLS checks. A single VM
   alone does not close the separate-client Windows acceptance requirement; do not
   assume that two Windows guests can comfortably run together on this laptop.
9. Remove only the exact internal test trust when finished. Fully shut down the
   guest. Keep evidence and update the acceptance record with actual results.

Production signing and any other external release inputs remain separate gates.
Do not mark them complete because a self-signed internal test succeeds.
