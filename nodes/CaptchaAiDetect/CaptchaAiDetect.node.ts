import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { nodeProperties } from './descriptions';
import { runDetection } from './libs/orchestrator';
import { toExecutionData } from './libs/output';
import { normalizeCaptchaTypes } from './libs/normalize-captcha-types';

export class CaptchaAiDetect implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'CaptchaAI Detect',
		name: 'captchaAiDetect',
		icon: { light: 'file:captchaAiDetect.svg', dark: 'file:captchaAiDetect.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["url"]}}',
		description:
			'Find CAPTCHA widgets on a page across every frame - reCAPTCHA, Turnstile, GeeTest v3, and more. Detection only: never solves, never injects a token, never submits a form.',
		defaults: {
			name: 'CaptchaAI Detect',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: nodeProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const url = this.getNodeParameter('url', i) as string;
			const requestedTypes = normalizeCaptchaTypes(this.getNodeParameter('captchaTypes', i));
			const timeout = Number(this.getNodeParameter('timeout', i)) || 30000;
			const triggerSelector = ((this.getNodeParameter('triggerSelector', i) as string) || '').trim() || undefined;
			const imageSelector = ((this.getNodeParameter('imageSelector', i) as string) || '').trim() || undefined;
			const inputSelector = ((this.getNodeParameter('inputSelector', i) as string) || '').trim() || undefined;

			try {
				const results = await runDetection({
					url: String(url).trim(),
					captchaTypes: requestedTypes,
					timeoutMs: timeout,
					triggerSelector,
					imageSelector,
					inputSelector,
				});

				for (const executionItem of toExecutionData(results)) {
					returnData.push({ ...executionItem, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
