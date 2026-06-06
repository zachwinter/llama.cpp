import { describe, it, expect } from 'vitest';
import { ModelsService } from '$lib/services/models.service';

describe('ModelsService', () => {
	describe('parseModelId', () => {
		it('parses google/gemma-4-26B-A4B-it-qat-q4_0-gguf correctly', () => {
			const result = ModelsService.parseModelId('google/gemma-4-26B-A4B-it-qat-q4_0-gguf');
			expect(result.raw).toBe('google/gemma-4-26B-A4B-it-qat-q4_0-gguf');
			expect(result.orgName).toBe('google');
			expect(result.modelName).toBe('gemma-4');
			expect(result.params).toBe('26B');
			expect(result.activatedParams).toBe('A4B');
			expect(result.quantization).toBeNull();
			expect(result.tags).toEqual(['it', 'qat', 'q4_0']);
		});

		it('parses google/gemma-4-26B-A4B-it-qat-q4_0-unquantized correctly', () => {
			const result = ModelsService.parseModelId(
				'google/gemma-4-26B-A4B-it-qat-q4_0-unquantized'
			);
			expect(result.raw).toBe('google/gemma-4-26B-A4B-it-qat-q4_0-unquantized');
			expect(result.orgName).toBe('google');
			expect(result.modelName).toBe('gemma-4');
			expect(result.params).toBe('26B');
			expect(result.activatedParams).toBe('A4B');
			expect(result.quantization).toBeNull();
			expect(result.tags).toEqual(['it', 'qat', 'q4_0', 'unquantized']);
		});

		it('parses google/gemma-4-26B-A4B-it-qat-q4_0-unquantized-assistant correctly', () => {
			const result = ModelsService.parseModelId(
				'google/gemma-4-26B-A4B-it-qat-q4_0-unquantized-assistant'
			);
			expect(result.raw).toBe('google/gemma-4-26B-A4B-it-qat-q4_0-unquantized-assistant');
			expect(result.orgName).toBe('google');
			expect(result.modelName).toBe('gemma-4');
			expect(result.params).toBe('26B');
			expect(result.activatedParams).toBe('A4B');
			expect(result.quantization).toBeNull();
			expect(result.tags).toEqual(['it', 'qat', 'q4_0', 'unquantized', 'assistant']);
		});

		// E2B/E4B: previously failed MODEL_PARAMS_RE before the [Ee]? prefix fix
		it('parses google/gemma-4-E2B-it-qat-q4_0-gguf with E2B as params', () => {
			const result = ModelsService.parseModelId('google/gemma-4-E2B-it-qat-q4_0-gguf');
			expect(result.raw).toBe('google/gemma-4-E2B-it-qat-q4_0-gguf');
			expect(result.orgName).toBe('google');
			expect(result.modelName).toBe('gemma-4');
			expect(result.params).toBe('E2B');
			expect(result.activatedParams).toBeNull();
			expect(result.quantization).toBeNull();
			expect(result.tags).toEqual(['it', 'qat', 'q4_0']);
		});

		it('parses google/gemma-4-E4B-it-qat-q4_0-gguf with E4B as params', () => {
			const result = ModelsService.parseModelId('google/gemma-4-E4B-it-qat-q4_0-gguf');
			expect(result.raw).toBe('google/gemma-4-E4B-it-qat-q4_0-gguf');
			expect(result.orgName).toBe('google');
			expect(result.modelName).toBe('gemma-4');
			expect(result.params).toBe('E4B');
			expect(result.activatedParams).toBeNull();
			expect(result.quantization).toBeNull();
			expect(result.tags).toEqual(['it', 'qat', 'q4_0']);
		});

		it('parses google/medgemma-27b-text-it correctly', () => {
			const result = ModelsService.parseModelId('google/medgemma-27b-text-it');
			expect(result.raw).toBe('google/medgemma-27b-text-it');
			expect(result.orgName).toBe('google');
			expect(result.modelName).toBe('medgemma');
			expect(result.params).toBe('27B');
			expect(result.activatedParams).toBeNull();
			expect(result.quantization).toBeNull();
			expect(result.tags).toEqual(['text', 'it']);
		});

		it('parses mlx-community/Qwen3.6-35B-A3B-6bit correctly', () => {
			const result = ModelsService.parseModelId('mlx-community/Qwen3.6-35B-A3B-6bit');
			expect(result.raw).toBe('mlx-community/Qwen3.6-35B-A3B-6bit');
			expect(result.orgName).toBe('mlx-community');
			expect(result.modelName).toBe('Qwen3.6');
			expect(result.params).toBe('35B');
			expect(result.activatedParams).toBe('A3B');
			expect(result.quantization).toBeNull();
			expect(result.tags).toEqual(['6bit']);
		});

		it('parses unsloth/medgemma-1.5-4b-it-GGUF correctly', () => {
			const result = ModelsService.parseModelId('unsloth/medgemma-1.5-4b-it-GGUF');
			expect(result.raw).toBe('unsloth/medgemma-1.5-4b-it-GGUF');
			expect(result.orgName).toBe('unsloth');
			expect(result.modelName).toBe('medgemma-1.5');
			expect(result.params).toBe('4B');
			expect(result.activatedParams).toBeNull();
			expect(result.quantization).toBeNull();
			expect(result.tags).toEqual(['it']);
		});

		it('always preserves the raw model ID string', () => {
			const id = 'google/gemma-4-E2B-it-qat-q4_0-gguf';
			expect(ModelsService.parseModelId(id).raw).toBe(id);
		});
	});
});
