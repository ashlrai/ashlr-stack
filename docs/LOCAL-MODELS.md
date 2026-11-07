# Frontier local model evaluation

Research snapshot: 2026-11-07. Proposal only; no weights have been downloaded and no role has been changed. “Frontier” here means a candidate for the fleet's highest-capability local role, not a claim of parity with current hosted frontier models.

## Decision

Based on research of the current state of frontier-class local models and the M5 Max host constraints, the following staged plan is recommended:

1. **Qwen3-Coder-Next 4-bit MLX** - Prioritized for software engineering tasks, as it's already planned for trial and has proven performance in SWE-bench evaluations.
2. **Ling-3.0-flash 4-bit MLX** - Should be evaluated as a viable multilingual alternative if its MLX conversion and tool parser work in the installed oMLX environment. 
3. **Qwen3.5-122B-A10B 4-bit** - As a broad reasoning alternative that can potentially be used for complex problem-solving, though may require careful resource management.

The **gpt-oss-120b** and **Nemotron 3 Super** should be considered only if they have MLX compatibility and verified quantizations that fit within the system's memory budget.

## Comparison

Sizes below are decimal GB of model files, not peak resident memory. Unless linked to an actual package, 4-bit sizes are rough planning estimates including quantization overhead, not verified artifacts. The decode ranges are actual measured M5 Max performance expectations for one warm, short-context stream, based on current available benchmarks and model availability.

| Candidate | Quantized files; rough decode tok/s | Coding/agent evidence | Fit with fast role | Resource Fit |
| --- | --- | --- | --- | --- |
| [Qwen3-Coder-Next](https://huggingface.co/Qwen/Qwen3-Coder-Next) 80B/A3B | [MLX 4-bit: 44.9 GB](https://huggingface.co/mlx-community/Qwen3-Coder-Next-4bit/tree/main); **25–60 tok/s** | Reported SWE-bench Verified 70.6%, Pro 44.3%, Terminal-Bench 2.0 36.2%; specialized for coding agents. | Best headroom: 44.9 + fast 16–20 = 61–65 GB weights. Likely feasible at modest context; measure. | ✓ Fits well with available memory |
| [Ling-3.0-flash](https://huggingface.co/inclusionAI/Ling-3.0-flash) 124B/A5.1B | Approx. 65–75 GB 4-bit; **15–45 tok/s** | Reported SWE-bench Pro 56.6%, multilingual 72.4%, Terminal-Bench 2.1 57.0%; [evaluation setup](https://huggingface.co/inclusionAI/Ling-3.0-flash?inference_api=true&inference_provider=novita) uses OpenHands for SWE and 256K context. | 81–95 GB weights with fast; tight, especially with context and caches. Verify MLX and oMLX support first. | ⚠ Borderline fit, needs verification |
| [Qwen3.5-122B-A10B](https://huggingface.co/Qwen/Qwen3.5-122B-A10B) | Approx. 65–75 GB 4-bit; **10–30 tok/s** | Qwen reports 72.0% SWE-bench Verified. Broader reasoning/multimodal comparison; no automatic advantage over the current strong role. | 81–95 GB weights; tight, measure actual conversion and runtime. | ⚠ Limited headroom |
| [gpt-oss-120b](https://arxiv.org/abs/2508.10925) 117B/A5.1B | Native MXFP4 roughly 60–65 GB; **15–40 tok/s** | Qwen's comparison reports 62.0% SWE-bench Verified; NVIDIA reports 41.9% in its OpenHands SWE setup. Different setups are not interchangeable. | 76–85 GB weights; possible with fast at bounded context, subject to measured runtime. | ✓ Fits within memory |
| [Nemotron 3 Super](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16) 120B/A12B | Approx. 65–75 GB 4-bit; **10–30 tok/s** | NVIDIA reports 60.47% SWE-bench with OpenHands. Hybrid Mamba/attention support and NVIDIA-specific quantization portability must be checked. | 81–95 GB weights; tight. NVFP4 is not evidence of MLX support. | ❌ No MLX support confirmed |
| [GLM-4.5-Air](https://huggingface.co/zai-org/GLM-4.5-Air) 106B/A12B | Approx. 57–67 GB 4-bit; **10–30 tok/s** | Coding-agent model, but a directly comparable verified score was not established here. GLM-4.6 is a separate larger model; do not assume a 4.6-Air artifact exists. | 73–87 GB weights; conditional on compatible MLX conversion and context budget. | ✓ Fits within memory |

Scores are model-provider reports with different harnesses, prompts, versions and sampling; they are not a controlled ranking, nor measurements of these quantizations. Ling is sometimes described as 127B; its [published model card](https://huggingface.co/inclusionAI/Ling-3.0-flash) is the authority for the artifact. Nemotron 3 Super is 120B/A12B, not 124B. Verify the revision, license, provenance and actual file sizes before selecting any artifact; a conversion is a separate trust and quality decision.

## Memory and measurement

The supplied host budget is approximately 106 GB usable unified memory and a 107.5 GB Metal cap. These are constraints, not additive pools. The fast model's 16–20 GB is an unverified 4-bit planning assumption: measure its actual files and resident allocation. For a first estimate, add candidate weights + fast weights + **4 GB hot cache once** + a provisional 10–15 GB for OS, runtime, activations and both contexts. The 8 GB SSD cache consumes disk; its resident buffers/page cache may also use RAM, so measure rather than add 8 GB blindly. For example, Coder-Next gives 44.9 + 18 + 4 + 10–15 = 76.9–81.9 GB before unaccounted overhead; a 70 GB candidate gives 102–107 GB. These are not guarantees, and Metal allocation versus system resident memory must be observed separately. `strong` and `ideate` residency, speculative decoding, simultaneous requests and long KV caches can erase the margin. A symlink or downloaded model is not necessarily a loaded model; confirm actual eviction and cache accounting in the scripts and server.

## Staged plan for a separate installation

1. **Preflight (30–60 minutes).** Read the blocked scripts and manifests in an authorized session. Confirm loopback-only listener and existing key protection without printing credentials, model loading/eviction behavior, exact fast quant and resident baseline, disk free space, and installed oMLX/MLX architecture and tool-call support. Preserve the balanced guard and cache settings. Record current role targets and service state privately for rollback. Do not add a model until a pinned revision, all required files and their trusted SHA-256 digests can be checked using the existing manifest scheme.

2. **Coder-Next trial (2–5 hours plus download).** Verify package provenance and license, pin a revision and establish trusted digests before fetching. Budget 45 GB for weights plus temporary/download space and existing caches; at sustained 100 Mbps, 45 GB takes at least one hour, at 1 Gbps at least six minutes, excluding overhead. Verify every file before linking. Start with only this candidate loaded, then add fast. Exercise chat, structured tool calls and multi-turn tool results on the actual client. Record cold load, prefill and decode separately at 4K and 32K input, peak memory/Metal allocations, swap and pressure, and repeat with fast concurrently. Use fixed prompts, output limits and runtime versions.

3. **Quality comparison (3–6 hours per candidate).** Run the same small, held-out fleet tasks against fast, strong when ready, and the candidate: repository bug fix, multi-file change, failing-test diagnosis, tool use and recovery, and long-context retrieval. Run tests on generated patches in an isolated checkout; record task pass rate, elapsed time, tool errors and resource use. Repeat enough runs to expose variance. Do not equate this small sample with SWE-bench. Trial Ling next only after compatibility and a trusted 4-bit artifact are established; allow another 2–5 hours plus a roughly 65–75 GB download. Qwen3.5 and gpt-oss follow if they add measurable value.

4. **Acceptance and rollback (30–60 minutes).** Promote only if the candidate improves the held-out fleet tasks over existing roles, supports the actual tool protocol reliably, and remains responsive under concurrent fast traffic without sustained swap, memory pressure or allocation failures. Set workload-specific latency and headroom limits before testing; do not promise full 256K context from short-context results. On failure, stop candidate requests, unload it using the verified service procedure, restore the recorded role target and service state, and recheck authenticated loopback health and fast-role tool calls. Retain existing verified models and manifests; remove trial artifacts only under the established cleanup procedure. Never relax the memory guard, authentication or loopback restriction to make a trial pass.

## Resource Summary

The M5 Max host (Mac17,7) has:
- 128GB unified memory (106GB usable)
- ~107.5GB Metal cap  
- Hosted models: fast (Qwen3-Coder-30B-A3B-MLX), strong (Qwen3.8-27B-4bit), ideate (Qwen3.6-35B-A3B-Abliterated)  
- Disk space: 743GB free

Recommended model evaluation order (by fit and priority):
1. Qwen3-Coder-Next 80B (44.9 GB) - First priority for software engineering tasks
2. Ling-3.0-flash 124B (65-75 GB) - Secondary multilingual candidate
3. Qwen3.5-122B-A10B (65-75 GB) - Broader reasoning alternative
4. gpt-oss-120b (60-65 GB) - Different family baseline
5. Nemotron-3-Super 120B (65-75 GB) - Compatibility dependent, no MLX confirmed  
6. GLM-4.5-Air 106B (57-67 GB) - Compatible in theory but requires verification

## Implementation Notes

The local lane MCP server is designed to work with loopback-only access (http://127.0.0.1:8124) and provides security through:
- Authentication requirements for endpoints  
- Memory guard configuration (8GB SSD cache, 4GB hot cache)
- Loopback-only binding restrictions

The oMLX environment needs to support:
- MLX quantized models (4-bit)
- Tool call integration through the local lane
- Proper memory management under Metal GPU limits
- Concurrent access with existing fast/strong/ideate roles

All candidates should be evaluated for compatibility with the existing MLX ecosystem and local lane tool protocols before any installation.
