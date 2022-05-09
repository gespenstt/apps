import CLayerAuth from '@commercelayer/js-auth';
import difference from 'lodash/difference';
import chunk from 'lodash/chunk';
import flatMap from 'lodash/flatMap';

import { setup, renderSkuPicker } from '@contentful/ecommerce-app-base';

import logo from './logo.svg';
import { dataTransformer } from './dataTransformer';

const DIALOG_ID = 'root';
const PER_PAGE = 20;

let accessToken = null;

function makeCTA(fieldType) {
  return fieldType === 'Array' ? 'Select products' : 'Select a product';
}

function validateParameters(parameters) {
  if (parameters.clientId.length < 1) {
    return 'Provide your application client ID.';
  }

  if (parameters.clientSecret.length < 1) {
    return 'Provide your application client secret.';
  }

  if (parameters.apiEndpoint.length < 1 || !parameters.apiEndpoint.startsWith('https://')) {
    return 'Provide a valid application Base endpoint.';
  }

  return null;
}

async function getAccessToken(clientId, endpoint, clientSecret) {
  if (!accessToken) {
    /* eslint-disable-next-line require-atomic-updates */
    accessToken = (
      await CLayerAuth.getIntegrationToken({
        clientId,
        endpoint: endpoint.startsWith('https://') ? endpoint : `https://${endpoint}`,
        clientSecret,
      })
    ).accessToken;
  }
  return accessToken;
}

/**
 * This function is needed to make the pagination of Commerce Layer work with the
 * @contentful/ecommerce-app-base library.
 *
 * When fetching the SKUs via the Commerce Layer JS SDK the metadata object which
 * includes the total count of records needed by the shared-sku-picker paginator
 * is missing. But it is there when fetching the SKUs via a plain HTTP req.
 */
async function fetchSKUs(installationParams, search, pagination) {
  const validationError = validateParameters(installationParams);
  if (validationError) {
    throw new Error(validationError);
  }

  const { clientId, apiEndpoint, clientSecret } = installationParams;
  const accessToken = await getAccessToken(clientId, apiEndpoint, clientSecret);

  const URL = `${apiEndpoint}/api/skus?page[size]=${PER_PAGE}&page[number]=${
    pagination.offset / PER_PAGE + 1
  }${search.length ? `&filter[q][name_or_code_cont]=${search}` : ''}`;

  const res = await fetch(URL, {
    headers: {
      Accept: 'application/vnd.api+json',
      Authorization: `Bearer ${accessToken}`,
    },
    method: 'GET',
  });

  return await res.json();
}

/**
 * Fetches the product previews for the products selected by the user.
 */
const fetchProductPreviews = async function fetchProductPreviews(skus, config) {
  if (!skus.length) {
    return [];
  }

  const PREVIEWS_PER_PAGE = 25;

  const { clientId, apiEndpoint, clientSecret } = config;
  const accessToken = await getAccessToken(clientId, apiEndpoint, clientSecret);

  // Commerce Layer's API automatically paginated results for collection endpoints.
  // Here we account for the edge case where the user has picked more than 25
  // products, which is the max amount of pagination results. We need to fetch
  // and compile the complete selection result doing 1 request per 25 items.
  const resultPromises = chunk(skus, PREVIEWS_PER_PAGE).map(async (skusSubset) => {
    const URL = `${apiEndpoint}/api/skus?page[size]=${PREVIEWS_PER_PAGE}&filter[q][code_in]=${skusSubset}`;
    const res = await fetch(URL, {
      headers: {
        Accept: 'application/vnd.api+json',
        Authorization: `Bearer ${accessToken}`,
      },
      method: 'GET',
    });
    return await res.json();
  });

  const results = await Promise.all(resultPromises);

  const foundProducts = flatMap(results, ({ data }) =>
    data.map(dataTransformer(config.apiEndpoint))
  );

  const missingProducts = difference(
    skus,
    foundProducts.map((product) => product.sku)
  ).map((sku) => ({ sku, isMissing: true, image: '', name: '', id: '' }));

  return [...foundProducts, ...missingProducts];
};

async function renderDialog(sdk) {
  const container = document.getElementById(DIALOG_ID);
  container.style.display = 'flex';
  container.style.flexDirection = 'column';

  renderSkuPicker(DIALOG_ID, {
    sdk,
    fetchProductPreviews,
    fetchProducts: async (search, pagination) => {
      const result = await fetchSKUs(sdk.parameters.installation, search, pagination);

      return {
        pagination: {
          count: PER_PAGE,
          limit: PER_PAGE,
          total: result.meta.record_count,
          offset: pagination.offset,
        },
        products: result.data.map(dataTransformer(sdk.parameters.installation.apiEndpoint)),
      };
    },
  });

  sdk.window.startAutoResizer();
}

async function openDialog(sdk, currentValue, config) {
  const skus = await sdk.dialogs.openCurrentApp({
    allowHeightOverflow: true,
    position: 'center',
    title: makeCTA(sdk.field.type),
    shouldCloseOnOverlayClick: true,
    shouldCloseOnEscapePress: true,
    parameters: config,
    width: 1400,
  });

  return Array.isArray(skus) ? skus : [];
}

function isDisabled(/* currentValue, config */) {
  // No restrictions need to be imposed as to when the field is disabled from the app's side
  return false;
}

setup({
  makeCTA,
  name: 'Commerce Layer',
  logo,
  description:
    'The Commerce Layer app allows editors to select products from their Commerce Layer account and reference them inside of Contentful entries.',
  color: '#212F3F',
  parameterDefinitions: [
    {
      id: 'clientId',
      name: 'Client ID',
      description: 'The client ID of your application',
      type: 'Symbol',
      required: true,
    },
    {
      id: 'clientSecret',
      name: 'Client Secret',
      description: 'The client secret of your application',
      type: 'Symbol',
      required: true,
    },
    {
      id: 'apiEndpoint',
      name: 'API Endpoint',
      description: 'Application Base endpoint (e.g., "https://acme.commercelayer.io")',
      type: 'Symbol',
      required: true,
    },
  ],
  fetchProductPreviews,
  renderDialog,
  openDialog,
  isDisabled,
  validateParameters,
});
