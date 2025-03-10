import { query } from '@metamask/controller-utils';
import type EthQuery from '@metamask/eth-query';

import type { UpdateGasRequest } from './gas';
import {
  addGasBuffer,
  estimateGas,
  updateGas,
  FIXED_GAS,
  DEFAULT_GAS_MULTIPLIER,
  GAS_ESTIMATE_FALLBACK_BLOCK_PERCENT,
  MAX_GAS_BLOCK_PERCENT,
} from './gas';
import { CHAIN_IDS } from '../constants';
import type { TransactionMeta } from '../types';

jest.mock('@metamask/controller-utils', () => ({
  ...jest.requireActual('@metamask/controller-utils'),
  query: jest.fn(),
}));

const GAS_MOCK = 100;
const BLOCK_GAS_LIMIT_MOCK = 123456789;
const BLOCK_NUMBER_MOCK = '0x5678';
const ETH_QUERY_MOCK = {} as unknown as EthQuery;
const FALLBACK_MULTIPLIER = GAS_ESTIMATE_FALLBACK_BLOCK_PERCENT / 100;
const MAX_GAS_MULTIPLIER = MAX_GAS_BLOCK_PERCENT / 100;

const TRANSACTION_META_MOCK = {
  txParams: {
    data: '0x1',
    to: '0x2',
  },
} as unknown as TransactionMeta;

const UPDATE_GAS_REQUEST_MOCK = {
  txMeta: TRANSACTION_META_MOCK,
  chainId: '0x0',
  isCustomNetwork: false,
  ethQuery: ETH_QUERY_MOCK,
} as UpdateGasRequest;

/**
 * Converts number to hex string.
 *
 * @param value - The number to convert.
 * @returns The hex string.
 */
function toHex(value: number) {
  return `0x${value.toString(16)}`;
}

describe('gas', () => {
  const queryMock = jest.mocked(query);
  let updateGasRequest: UpdateGasRequest;

  /**
   * Mocks query responses.
   *
   * @param options - The options.
   * @param options.getCodeResponse - The response for getCode.
   * @param options.getBlockByNumberResponse - The response for getBlockByNumber.
   * @param options.estimateGasResponse - The response for estimateGas.
   * @param options.estimateGasError - The error for estimateGas.
   */
  function mockQuery({
    getCodeResponse,
    getBlockByNumberResponse,
    estimateGasResponse,
    estimateGasError,
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getCodeResponse?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getBlockByNumberResponse?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    estimateGasResponse?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    estimateGasError?: any;
  }) {
    if (getCodeResponse !== undefined) {
      queryMock.mockResolvedValueOnce(getCodeResponse);
    }

    if (getBlockByNumberResponse !== undefined) {
      queryMock.mockResolvedValueOnce(getBlockByNumberResponse);
    }

    if (estimateGasError) {
      queryMock.mockRejectedValueOnce(estimateGasError);
    } else {
      queryMock.mockResolvedValueOnce(estimateGasResponse);
    }
  }

  /**
   * Assert that estimateGas was not called.
   */
  function expectEstimateGasNotCalled() {
    expect(queryMock).not.toHaveBeenCalledWith(
      expect.anything(),
      'estimateGas',
      expect.anything(),
    );
  }

  beforeEach(() => {
    updateGasRequest = JSON.parse(JSON.stringify(UPDATE_GAS_REQUEST_MOCK));
    jest.resetAllMocks();
  });

  describe('updateGas', () => {
    describe('sets gas', () => {
      afterEach(() => {
        // eslint-disable-next-line jest/no-standalone-expect
        expect(updateGasRequest.txMeta.defaultGasEstimates?.gas).toBe(
          updateGasRequest.txMeta.txParams.gas,
        );
      });

      it('to request value if set', async () => {
        updateGasRequest.txMeta.txParams.gas = toHex(GAS_MOCK);

        await updateGas(updateGasRequest);

        expect(updateGasRequest.txMeta.txParams.gas).toBe(toHex(GAS_MOCK));
        expect(updateGasRequest.txMeta.originalGasEstimate).toBeUndefined();
        expectEstimateGasNotCalled();
      });

      it('to estimate if custom network', async () => {
        updateGasRequest.isCustomNetwork = true;

        mockQuery({
          getBlockByNumberResponse: { gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK) },
          estimateGasResponse: toHex(GAS_MOCK),
        });

        await updateGas(updateGasRequest);

        expect(updateGasRequest.txMeta.txParams.gas).toBe(toHex(GAS_MOCK));
        expect(updateGasRequest.txMeta.originalGasEstimate).toBe(
          updateGasRequest.txMeta.txParams.gas,
        );
      });

      it('to estimate if not custom network and no to parameter', async () => {
        updateGasRequest.isCustomNetwork = false;
        const gasEstimation = Math.ceil(GAS_MOCK * DEFAULT_GAS_MULTIPLIER);
        delete updateGasRequest.txMeta.txParams.to;
        mockQuery({
          getBlockByNumberResponse: { gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK) },
          estimateGasResponse: toHex(GAS_MOCK),
        });

        await updateGas(updateGasRequest);

        expect(updateGasRequest.txMeta.txParams.gas).toBe(toHex(gasEstimation));
        expect(updateGasRequest.txMeta.originalGasEstimate).toBe(
          updateGasRequest.txMeta.txParams.gas,
        );
      });

      it('to estimate if estimate greater than percentage of block gas limit', async () => {
        const estimatedGas = Math.ceil(
          BLOCK_GAS_LIMIT_MOCK * MAX_GAS_MULTIPLIER + 10,
        );

        mockQuery({
          getBlockByNumberResponse: { gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK) },
          estimateGasResponse: toHex(estimatedGas),
        });

        await updateGas(updateGasRequest);

        expect(updateGasRequest.txMeta.txParams.gas).toBe(toHex(estimatedGas));
        expect(updateGasRequest.txMeta.originalGasEstimate).toBe(
          updateGasRequest.txMeta.txParams.gas,
        );
      });

      it('to padded estimate if padded estimate less than percentage of block gas limit', async () => {
        const maxGasLimit = BLOCK_GAS_LIMIT_MOCK * MAX_GAS_MULTIPLIER;
        const estimatedGasPadded = Math.floor(maxGasLimit) - 10;
        const estimatedGas = Math.ceil(
          estimatedGasPadded / DEFAULT_GAS_MULTIPLIER,
        );

        mockQuery({
          getBlockByNumberResponse: { gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK) },
          estimateGasResponse: toHex(estimatedGas),
        });

        await updateGas(updateGasRequest);

        expect(updateGasRequest.txMeta.txParams.gas).toBe(
          toHex(estimatedGasPadded),
        );
        expect(updateGasRequest.txMeta.originalGasEstimate).toBe(
          updateGasRequest.txMeta.txParams.gas,
        );
        expect(updateGasRequest.txMeta.gasLimitNoBuffer).toBe(
          toHex(estimatedGas),
        );
      });

      it('to padded estimate using chain multiplier if padded estimate less than percentage of block gas limit', async () => {
        const maxGasLimit = BLOCK_GAS_LIMIT_MOCK * MAX_GAS_MULTIPLIER;
        const estimatedGasPadded = Math.ceil(maxGasLimit - 10);
        const estimatedGas = estimatedGasPadded; // Optimism multiplier is 1

        updateGasRequest.chainId = CHAIN_IDS.OPTIMISM;

        mockQuery({
          getBlockByNumberResponse: { gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK) },
          estimateGasResponse: toHex(estimatedGas),
        });

        await updateGas(updateGasRequest);

        expect(updateGasRequest.txMeta.txParams.gas).toBe(
          toHex(estimatedGasPadded),
        );
        expect(updateGasRequest.txMeta.originalGasEstimate).toBe(
          updateGasRequest.txMeta.txParams.gas,
        );
        expect(updateGasRequest.txMeta.gasLimitNoBuffer).toBe(
          toHex(estimatedGas),
        );
      });

      it('to percentage of block gas limit if padded estimate only is greater than percentage of block gas limit', async () => {
        const maxGasLimit = Math.round(
          BLOCK_GAS_LIMIT_MOCK * MAX_GAS_MULTIPLIER,
        );
        const estimatedGasPadded = maxGasLimit + 10;
        const estimatedGas = Math.ceil(
          estimatedGasPadded / DEFAULT_GAS_MULTIPLIER,
        );

        mockQuery({
          getBlockByNumberResponse: { gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK) },
          estimateGasResponse: toHex(estimatedGas),
        });

        await updateGas(updateGasRequest);

        expect(updateGasRequest.txMeta.txParams.gas).toBe(toHex(maxGasLimit));
        expect(updateGasRequest.txMeta.originalGasEstimate).toBe(
          updateGasRequest.txMeta.txParams.gas,
        );
        expect(updateGasRequest.txMeta.gasLimitNoBuffer).toBe(
          toHex(estimatedGas),
        );
      });

      describe('to fixed value', () => {
        it('if not custom network and to parameter and no data and no code', async () => {
          updateGasRequest.isCustomNetwork = false;
          delete updateGasRequest.txMeta.txParams.data;

          mockQuery({
            getCodeResponse: null,
          });

          await updateGas(updateGasRequest);

          expect(updateGasRequest.txMeta.txParams.gas).toBe(FIXED_GAS);
          expect(updateGasRequest.txMeta.originalGasEstimate).toBe(
            updateGasRequest.txMeta.txParams.gas,
          );
          expectEstimateGasNotCalled();
        });

        it('if not custom network and to parameter and no data and empty code', async () => {
          updateGasRequest.isCustomNetwork = false;
          delete updateGasRequest.txMeta.txParams.data;

          mockQuery({
            getCodeResponse: '0x',
          });

          await updateGas(updateGasRequest);

          expect(updateGasRequest.txMeta.txParams.gas).toBe(FIXED_GAS);
          expect(updateGasRequest.txMeta.originalGasEstimate).toBe(
            updateGasRequest.txMeta.txParams.gas,
          );
          expectEstimateGasNotCalled();
        });
      });
    });

    describe('on estimate query error', () => {
      it('sets gas to 35% of block gas limit', async () => {
        const fallbackGas = Math.floor(
          BLOCK_GAS_LIMIT_MOCK * FALLBACK_MULTIPLIER,
        );

        mockQuery({
          getBlockByNumberResponse: {
            gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK),
          },
          estimateGasError: { message: 'TestError', errorKey: 'TestKey' },
        });

        await updateGas(updateGasRequest);

        expect(updateGasRequest.txMeta.txParams.gas).toBe(toHex(fallbackGas));
        expect(updateGasRequest.txMeta.originalGasEstimate).toBe(
          updateGasRequest.txMeta.txParams.gas,
        );
      });

      it('sets simulationFails property', async () => {
        mockQuery({
          getBlockByNumberResponse: {
            gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK),
            number: BLOCK_NUMBER_MOCK,
          },
          estimateGasError: { message: 'TestError', errorKey: 'TestKey' },
        });

        await updateGas(updateGasRequest);

        expect(updateGasRequest.txMeta.simulationFails).toStrictEqual({
          reason: 'TestError',
          errorKey: 'TestKey',
          debug: {
            blockGasLimit: toHex(BLOCK_GAS_LIMIT_MOCK),
            blockNumber: BLOCK_NUMBER_MOCK,
          },
        });
      });
    });
  });

  describe('estimateGas', () => {
    it('returns block gas limit and estimated gas', async () => {
      mockQuery({
        getBlockByNumberResponse: { gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK) },
        estimateGasResponse: toHex(GAS_MOCK),
      });

      const result = await estimateGas(
        { ...TRANSACTION_META_MOCK.txParams, data: undefined },
        ETH_QUERY_MOCK,
      );

      expect(result).toStrictEqual({
        estimatedGas: toHex(GAS_MOCK),
        blockGasLimit: toHex(BLOCK_GAS_LIMIT_MOCK),
        simulationFails: undefined,
      });
    });

    it('returns simulationFails on error', async () => {
      mockQuery({
        getBlockByNumberResponse: {
          gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK),
          number: BLOCK_NUMBER_MOCK,
        },
        estimateGasError: { message: 'TestError', errorKey: 'TestKey' },
      });

      const result = await estimateGas(
        TRANSACTION_META_MOCK.txParams,
        ETH_QUERY_MOCK,
      );

      expect(result).toStrictEqual({
        estimatedGas: expect.any(String),
        blockGasLimit: toHex(BLOCK_GAS_LIMIT_MOCK),
        simulationFails: {
          reason: 'TestError',
          errorKey: 'TestKey',
          debug: {
            blockGasLimit: toHex(BLOCK_GAS_LIMIT_MOCK),
            blockNumber: BLOCK_NUMBER_MOCK,
          },
        },
      });
    });

    it('returns estimated gas as 35% of block gas limit on error', async () => {
      const fallbackGas = Math.floor(
        BLOCK_GAS_LIMIT_MOCK * FALLBACK_MULTIPLIER,
      );

      mockQuery({
        getBlockByNumberResponse: {
          gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK),
        },
        estimateGasError: { message: 'TestError', errorKey: 'TestKey' },
      });

      const result = await estimateGas(
        TRANSACTION_META_MOCK.txParams,
        ETH_QUERY_MOCK,
      );

      expect(result).toStrictEqual({
        estimatedGas: toHex(fallbackGas),
        blockGasLimit: toHex(BLOCK_GAS_LIMIT_MOCK),
        simulationFails: expect.any(Object),
      });
    });

    it('removes gas fee properties from estimate request', async () => {
      mockQuery({
        getBlockByNumberResponse: { gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK) },
        estimateGasResponse: toHex(GAS_MOCK),
      });

      await estimateGas(
        {
          ...TRANSACTION_META_MOCK.txParams,
          gasPrice: '0x1',
          maxFeePerGas: '0x2',
          maxPriorityFeePerGas: '0x3',
        },
        ETH_QUERY_MOCK,
      );

      expect(queryMock).toHaveBeenCalledWith(ETH_QUERY_MOCK, 'estimateGas', [
        {
          ...TRANSACTION_META_MOCK.txParams,
          value: expect.anything(),
        },
      ]);
    });

    it('normalizes data in estimate request', async () => {
      mockQuery({
        getBlockByNumberResponse: { gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK) },
        estimateGasResponse: toHex(GAS_MOCK),
      });

      await estimateGas(
        {
          ...TRANSACTION_META_MOCK.txParams,
          data: '123',
        },
        ETH_QUERY_MOCK,
      );

      expect(queryMock).toHaveBeenCalledWith(ETH_QUERY_MOCK, 'estimateGas', [
        expect.objectContaining({
          ...TRANSACTION_META_MOCK.txParams,
          data: '0x123',
        }),
      ]);
    });

    it('normalizes value in estimate request', async () => {
      mockQuery({
        getBlockByNumberResponse: { gasLimit: toHex(BLOCK_GAS_LIMIT_MOCK) },
        estimateGasResponse: toHex(GAS_MOCK),
      });

      await estimateGas(
        {
          ...TRANSACTION_META_MOCK.txParams,
          value: undefined,
        },
        ETH_QUERY_MOCK,
      );

      expect(queryMock).toHaveBeenCalledWith(ETH_QUERY_MOCK, 'estimateGas', [
        {
          ...TRANSACTION_META_MOCK.txParams,
          value: '0x0',
        },
      ]);
    });
  });

  describe('addGasBuffer', () => {
    it('returns estimated gas if greater than percentage of block gas limit', () => {
      const estimatedGas = Math.ceil(
        BLOCK_GAS_LIMIT_MOCK * MAX_GAS_MULTIPLIER + 10,
      );

      const result = addGasBuffer(
        toHex(estimatedGas),
        toHex(BLOCK_GAS_LIMIT_MOCK),
        DEFAULT_GAS_MULTIPLIER,
      );

      expect(result).toBe(toHex(estimatedGas));
    });

    it('returns padded estimate if less than percentage of block gas limit', () => {
      const maxGasLimit = BLOCK_GAS_LIMIT_MOCK * MAX_GAS_MULTIPLIER;
      const estimatedGasPadded = Math.floor(maxGasLimit - 10);
      const estimatedGas = Math.ceil(
        estimatedGasPadded / DEFAULT_GAS_MULTIPLIER,
      );

      const result = addGasBuffer(
        toHex(estimatedGas),
        toHex(BLOCK_GAS_LIMIT_MOCK),
        DEFAULT_GAS_MULTIPLIER,
      );

      expect(result).toBe(toHex(estimatedGasPadded));
    });

    it('returns percentage of block gas limit if padded estimate only is greater than percentage of block gas limit', () => {
      const maxGasLimit = Math.round(BLOCK_GAS_LIMIT_MOCK * MAX_GAS_MULTIPLIER);
      const estimatedGasPadded = maxGasLimit + 10;
      const estimatedGas = Math.ceil(
        estimatedGasPadded / DEFAULT_GAS_MULTIPLIER,
      );

      const result = addGasBuffer(
        toHex(estimatedGas),
        toHex(BLOCK_GAS_LIMIT_MOCK),
        DEFAULT_GAS_MULTIPLIER,
      );

      expect(result).toBe(toHex(maxGasLimit));
    });
  });
});
