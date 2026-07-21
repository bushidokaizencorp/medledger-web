'use strict';
/**
 * MCAZ / GS1 EPCIS 2.0 traceability.
 *
 * Records supply-chain events (commissioning on receipt, shipping/dispensing
 * on sale, decommissioning on expiry, recall) as EPCIS 2.0 documents. In
 * simulator mode the event is stored and marked acknowledged; in live mode it
 * would be transmitted to the MCAZ/TRVST endpoint. Either way it is persisted
 * and auditable.
 */
const { env } = require('../config/env');
const { iso } = require('../lib/dates');

const BIZ_STEPS = {
  commissioning: 'urn:epcglobal:cbv:bizstep:commissioning',
  shipping: 'urn:epcglobal:cbv:bizstep:shipping',
  receiving: 'urn:epcglobal:cbv:bizstep:receiving',
  dispensing: 'urn:epcglobal:cbv:bizstep:dispensing',
  decommissioning: 'urn:epcglobal:cbv:bizstep:decommissioning',
};

function buildEpcisEvent({ eventType, bizStep, disposition, epc, quantity, eventTime }) {
  return {
    '@context': ['https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld'],
    type: 'EPCISDocument',
    schemaVersion: '2.0',
    creationDate: eventTime,
    epcisBody: {
      eventList: [{
        type: eventType,
        eventTime,
        eventTimeZoneOffset: '+02:00', // CAT
        ...(epc ? { epcList: [epc] } : {}),
        ...(quantity != null ? { quantityList: [{ epcClass: epc, quantity }] } : {}),
        action: 'ADD',
        bizStep: BIZ_STEPS[bizStep] || bizStep,
        disposition: disposition || null,
      }],
    },
  };
}

async function recordEvent(trx, {
  legalEntityId, eventType = 'ObjectEvent', bizStep, disposition = null,
  itemId = null, batchLotId = null, epc = null, quantity = null,
  refTable = null, refId = null, userId = null,
}) {
  const eventTime = iso();
  const payload = buildEpcisEvent({ eventType, bizStep, disposition, epc, quantity, eventTime });
  const submissionStatus = env.MCAZ_MODE === 'live' ? 'PENDING' : 'ACKED';

  const [id] = await trx('traceability_events').insert({
    legal_entity_id: legalEntityId, event_type: eventType, biz_step: bizStep,
    disposition, item_id: itemId, batch_lot_id: batchLotId, epc, quantity,
    reference_table: refTable, reference_id: refId, event_time: eventTime,
    epcis_payload: JSON.stringify(payload), submission_status: submissionStatus,
    mode: env.MCAZ_MODE, submitted_at: submissionStatus === 'ACKED' ? eventTime : null,
    created_by: userId, created_at: eventTime,
  });
  return trx('traceability_events').where({ id }).first();
}

module.exports = { BIZ_STEPS, buildEpcisEvent, recordEvent };
