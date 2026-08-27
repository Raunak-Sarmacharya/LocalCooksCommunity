import React from "react";

export default function TermsContent_fr_2() {
  return (
    <>
      {/* SECTION 6 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">6. EXIGENCES D'ASSURANCE</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.1 Résumé de l'assurance du Chef</h3>
      <div className="overflow-x-auto mb-4">
        <table className="min-w-full border border-gray-300 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border border-gray-300 px-3 py-2 text-left">Type de couverture</th>
              <th className="border border-gray-300 px-3 py-2 text-left">Limite minimale</th>
              <th className="border border-gray-300 px-3 py-2 text-left">Dispositions clés</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-gray-300 px-3 py-2">Responsabilité civile générale ou des produits</td>
              <td className="border border-gray-300 px-3 py-2">1 M$ par événement</td>
              <td className="border border-gray-300 px-3 py-2">Doit nommer le Propriétaire de la cuisine comme assuré supplémentaire si requis ; primaire, non contributive</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-3 py-2">Indemnisation des accidents du travail (le cas échéant)</td>
              <td className="border border-gray-300 px-3 py-2">Limites légales (par province)</td>
              <td className="border border-gray-300 px-3 py-2">Obligatoire si le Chef a des employés ; dépend de la législation provinciale</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-3 py-2">Maladies d'origine alimentaire</td>
              <td className="border border-gray-300 px-3 py-2">Norme de l'industrie</td>
              <td className="border border-gray-300 px-3 py-2">Recommandé en cas de préparation d'aliments potentiellement dangereux</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.2 Certificat d'assurance</h3>
      <p className="mb-2">Les Propriétaires de cuisines et les Chefs doivent fournir, lorsque l'assurance est requise :</p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>Certificat d'assurance</strong> (émis par un courtier ou un assureur) prouvant la couverture requise</li>
        <li><strong>Preuve d'avenant d'assuré supplémentaire</strong> (par exemple, ISO CG 20 01 pour la responsabilité, ou annexe de police)</li>
        <li><strong>Avis de non-annulation</strong> (préavis d'au moins 10 jours à Local Cooks si la police est annulée ou non renouvelée)</li>
      </ul>
      <p className="mb-4">Les certificats sont valables un an. Local Cooks demandera des certificats mis à jour chaque année.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.3 Vérification de l'assurance</h3>
      <p className="mb-2">Local Cooks vérifiera que :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Le certificat est émis par un courtier/assureur agréé</li>
        <li>Les limites de couverture respectent les minimums</li>
        <li>L'avenant d'assuré supplémentaire est présent</li>
        <li>Le certificat n'a pas expiré</li>
      </ul>
      <p className="mb-2">Local Cooks NE vérifiera PAS :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Que l'assurance est active ou a été payée</li>
        <li>N'appellera pas les assureurs indépendamment pour confirmer la couverture</li>
        <li>N'évaluera pas l'adéquation de la couverture pour des risques spécifiques</li>
        <li>Ne fournira pas de conseils en assurance</li>
      </ul>
      <p className="mb-4">Les deux parties sont responsables de s'assurer que leur assurance est active et adéquate.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">6.4 Renonciation à la subrogation</h3>
      <p className="mb-2">Les Propriétaires de cuisines et les Chefs s'accordent mutuellement ainsi qu'à Local Cooks une renonciation aux droits de subrogation. Cela signifie :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Si un Chef est blessé dans la Cuisine et que son assurance couvre la blessure, l'assureur du Chef renonce au droit de poursuivre le Propriétaire de la cuisine pour remboursement.</li>
        <li>Inversement, si le Propriétaire de la cuisine cause des dommages matériels à l'équipement du Chef, l'assureur du Propriétaire de la cuisine renonce au droit de poursuivre le Chef.</li>
      </ul>
      <p className="mb-4">Cette renonciation mutuelle réduit les litiges liés aux réclamations et favorise la coopération.</p>

      <hr className="my-8" />

      {/* SECTION 7 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">7. RESPONSABILITÉ ET INDEMNISATION</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.1 Responsabilité limitée de Local Cooks</h3>
      <p className="mb-2">Local Cooks n'assume AUCUNE responsabilité pour :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>L'état, la sécurité ou la conformité réglementaire de toute Cuisine</li>
        <li>La qualité, la sécurité ou la légalité des aliments préparés dans toute Cuisine</li>
        <li>Toutes blessures, maladies ou dommages matériels survenant dans toute Cuisine</li>
        <li>Toute violation de la Loi applicable par le Propriétaire de la cuisine ou le Chef</li>
        <li>Toute maladie d'origine alimentaire ou réaction allergique causée par des produits alimentaires</li>
        <li>Toute panne ou dysfonctionnement de l'équipement dans toute Cuisine</li>
        <li>Toutes réclamations de tiers (par exemple, les réclamations des clients du Chef)</li>
        <li>Toute perte d'exploitation, perte de profits ou interruption causée par l'indisponibilité de la Cuisine</li>
        <li>Toute cyberattaque, violation de données ou temps d'arrêt de la plateforme</li>
        <li>Tous actes ou omissions des Propriétaires de cuisines, des Chefs ou de tiers</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.2 Indemnisation du Chef au Propriétaire de cuisine</h3>
      <p className="mb-2">Le Chef devra indemniser, défendre (aux frais du Chef) et dégager de toute responsabilité le Propriétaire de la cuisine et tous ses affiliés, dirigeants, employés, agents et représentants contre toutes réclamations, poursuites, dommages, responsabilités, coûts et dépenses (y compris les honoraires d'avocat et frais de justice raisonnables) découlant de ou liés à :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>L'utilisation de la Cuisine par le Chef ou les produits alimentaires préparés par le Chef</li>
        <li>La violation par le Chef des présentes Conditions ou de la Loi applicable</li>
        <li>Des blessures à toute personne (y compris le personnel du Chef, les clients ou des tiers) causées par les actions ou les aliments du Chef</li>
        <li>Dommages matériels à la Cuisine ou à l'équipement du Propriétaire de la cuisine causés par le Chef</li>
        <li>La négligence, l'inconduite volontaire ou la violation des règles de salubrité alimentaire par le Chef</li>
        <li>Toute réclamation pour maladie d'origine alimentaire, réaction allergique ou contamination liée aux aliments du Chef</li>
      </ul>
      <p className="mb-4">Cette indemnisation survit à la résiliation de la Réservation et survit à l'implication de Local Cooks.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.3 Indemnisation du Propriétaire de cuisine au Chef</h3>
      <p className="mb-2">Le Propriétaire de la cuisine devra indemniser, défendre (aux frais du Propriétaire) et dégager de toute responsabilité le Chef et tous ses affiliés, dirigeants, employés, agents et représentants contre toutes réclamations, poursuites, dommages, responsabilités, coûts et dépenses (y compris les honoraires d'avocat et frais de justice raisonnables) découlant de ou liés à :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>L'état de la Cuisine, l'équipement ou les installations (y compris l'équipement défectueux, les conditions dangereuses, le mauvais entretien)</li>
        <li>La violation par le Propriétaire de la cuisine des présentes Conditions ou de la Loi applicable</li>
        <li>Des blessures au Chef causées par l'état de la Cuisine, une panne d'équipement ou la négligence du Propriétaire de la cuisine</li>
        <li>Toute violation des exigences de sécurité alimentaire, du code du bâtiment ou du code des incendies causée par le Propriétaire de la cuisine</li>
        <li>Le manquement du Propriétaire de la cuisine à maintenir des licences, assurances ou permis valides</li>
      </ul>
      <p className="mb-4">Cette indemnisation survit à la résiliation de la Réservation et survit à l'implication de Local Cooks.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.4 Indemnisation de Local Cooks (limitée)</h3>
      <p className="mb-2">Local Cooks indemnisera le Propriétaire de la cuisine et le Chef des réclamations découlant uniquement de :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Négligence grave ou inconduite volontaire de Local Cooks dans l'exploitation de la Plateforme</li>
        <li>La violation par Local Cooks des présentes Conditions (mais PAS des actions de tiers ou des réclamations liées à la sécurité alimentaire)</li>
        <li>Violation de données ou accès non autorisé aux Informations personnelles (si causé par une défaillance de sécurité de Local Cooks)</li>
      </ul>
      <p className="mb-2">Local Cooks n'indemnise PAS pour les réclamations découlant de :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>La conduite ou la négligence du Propriétaire de la cuisine ou du Chef</li>
        <li>Réclamations liées à la salubrité alimentaire ou aux maladies d'origine alimentaire</li>
        <li>Problèmes d'équipement ou d'état de la cuisine</li>
        <li>Réclamations de tiers (par exemple, les plaintes des clients)</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">7.5 Coopération mutuelle sur les réclamations</h3>
      <p className="mb-2">Si un tiers (par exemple, un client blessé par les aliments du Chef) poursuit à la fois le Propriétaire de la cuisine et le Chef par l'intermédiaire de Local Cooks :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Le Chef et le Propriétaire de la cuisine coopéreront pleinement à la défense de la réclamation</li>
        <li>Chacun partagera les informations pertinentes avec l'assureur de l'autre</li>
        <li>Les indemnisations s'appliquent dans la mesure où la conduite d'une partie a causé la blessure (le Chef si lié à l'alimentation ; le Propriétaire si lié à l'état de la cuisine)</li>
        <li>Si un tribunal détermine que les deux parties sont conjointement responsables, leurs assureurs contribueront proportionnellement</li>
      </ul>

      <hr className="my-8" />

      {/* SECTION 8 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">8. SALUBRITÉ ALIMENTAIRE ET CONFORMITÉ LÉGALE</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.1 Règlement sur les établissements alimentaires de Terre-Neuve-et-Labrador</h3>
      <p className="mb-2">Toutes les Cuisines et la préparation des aliments doivent être conformes à :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Règlement sur les établissements alimentaires (Règlement consolidé de Terre-Neuve 1022/96) en vertu de la Loi sur les aliments et drogues</li>
        <li>Loi sur les services de santé et communautaires</li>
        <li>Loi sur la santé et la sécurité au travail (pour la sécurité des travailleurs)</li>
        <li>Code du bâtiment (Code national du bâtiment tel qu'adopté par Terre-Neuve)</li>
        <li>Règlements municipaux (St. John's ou municipalité concernée)</li>
      </ul>
      <p className="mb-4">Des copies de la réglementation sont disponibles auprès de Service NL (www.gov.nl.ca) et doivent être consultées par tous les Propriétaires et Chefs.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.2 Exigences du permis d'établissement alimentaire</h3>
      <p className="mb-2">Le permis d'établissement alimentaire du Propriétaire de la cuisine doit :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Être valide et non expiré (tel qu'indiqué sur le certificat)</li>
        <li>Couvrir l'adresse spécifique et le type d'opération alimentaire répertoriés sur Local Cooks</li>
        <li>Ne présenter aucune violation en suspens, condition ou suspension (en date de l'inspection la plus récente)</li>
        <li>Être maintenu en règle et de façon continue pour la durée de l'utilisation de la Plateforme par le Propriétaire de la cuisine</li>
      </ul>
      <p className="mb-2">Le Propriétaire de la cuisine doit :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Fournir une copie de la licence à Local Cooks au moment de l'inscription et annuellement par la suite</li>
        <li>Informer Local Cooks dans les 24 heures si la licence est suspendue, révoquée ou soumise à des conditions</li>
        <li>Coopérer immédiatement avec les inspecteurs de la sécurité alimentaire et fournir à Local Cooks les rapports d'inspection dans les 5 jours</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.3 Certification de manipulateur d'aliments</h3>
      <p className="mb-2">Au moins une personne présente lors de la préparation des aliments dans la Cuisine doit détenir une certification de manipulateur d'aliments valide (ou un certificat de formation en sécurité alimentaire équivalent) délivrée par un fournisseur agréé, tel que :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Cours en ligne approuvés par Santé Canada</li>
        <li>Cours du Conseil canadien de la certification en salubrité alimentaire</li>
        <li>Formation FoodSafe de l'Alberta Health Services</li>
        <li>Autres fournisseurs accrédités reconnus à Terre-Neuve-et-Labrador</li>
      </ul>
      <p className="mb-2">Le personnel du Propriétaire de la cuisine et les Chefs doivent fournir une preuve de certification à Local Cooks. La preuve doit comprendre :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Le nom et le numéro du certificat</li>
        <li>Le nom du titulaire (correspondant à l'identité de la personne)</li>
        <li>Les dates d'émission et d'expiration</li>
        <li>Le nom du fournisseur du cours</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.4 Produits et procédés alimentaires approuvés</h3>
      <p className="mb-2">Le Propriétaire de la cuisine peut restreindre les types de produits alimentaires préparés dans la Cuisine. Les restrictions courantes incluent :</p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>Aliments à haut risque (potentiellement dangereux) :</strong> Exigent une manipulation spéciale, un contrôle de la température et une analyse des risques</li>
        <li><strong>Produits de la viande et du poisson :</strong> Peuvent nécessiter des installations séparées ou des licences spécifiques</li>
        <li><strong>Aliments sujets aux allergènes :</strong> Peuvent nécessiter des zones de préparation et des équipements séparés</li>
        <li><strong>Aliments nécessitant des procédés programmés :</strong> Les aliments acidifiés (cornichons, condiments, vinaigrettes, confitures) peuvent nécessiter une licence supplémentaire/une approbation du procédé</li>
      </ul>
      <p className="mb-2">Le Chef doit :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Divulguer le(s) produit(s) alimentaire(s) spécifique(s) prévu(s) pour la préparation (par exemple, "mousse au chocolat végétalienne" au lieu de "galettes de viande hachée crue")</li>
        <li>Obtenir l'approbation du Propriétaire de la cuisine avant la Réservation si le type de produit n'est pas pré-approuvé</li>
        <li>Suivre tous les protocoles de salubrité alimentaire spécifiques au produit (journaux de temps/température, séparation des allergènes, etc.)</li>
        <li>Obtenir toutes les approbations réglementaires requises avant la préparation (par exemple, si le produit nécessite une approbation de procédé programmé d'une autorité de transformation qualifiée)</li>
      </ul>
      <p className="mb-4">Local Cooks n'approuve pas les produits ou procédés alimentaires. Cela se fait uniquement entre le Propriétaire de la cuisine et le Chef.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.5 Contrôle de la température et HACCP</h3>
      <p className="mb-2">Les Chefs doivent maintenir des températures adéquates pour les aliments :</p>
      <ul className="list-disc pl-6 mb-4">
        <li><strong>Aliments chauds :</strong> ≥63°C (145°F) jusqu'au service</li>
        <li><strong>Aliments froids :</strong> ≤4°C (40°F) pendant l'entreposage et le service</li>
        <li><strong>Congélateur :</strong> ≤-18°C (0°F)</li>
      </ul>
      <p className="mb-2">Il est recommandé aux Chefs qui préparent des aliments potentiellement dangereux de mettre en œuvre les principes de l'analyse des risques et de la maîtrise des points critiques (HACCP) :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Identifier les points critiques de contrôle (par exemple, température de cuisson, temps de refroidissement)</li>
        <li>Établir des procédures de surveillance (par exemple, utilisation de thermomètres alimentaires)</li>
        <li>Maintenir des registres/journaux des températures critiques</li>
        <li>Mesures correctives si les températures sont hors normes</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.6 Gestion des allergènes</h3>
      <p className="mb-2">Le Chef doit :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Divulguer tous les allergènes majeurs dans les produits alimentaires (arachides, noix, lait, œufs, soja, blé, poisson, crustacés, sésame, sulfites, moutarde, céleri, etc.)</li>
        <li>Étiqueter les produits finis avec des listes d'ingrédients complètes et des déclarations d'allergènes</li>
        <li>Prévenir la contamination croisée en utilisant des ustensiles, des planches à découper et des surfaces distincts pour les aliments sensibles aux allergènes</li>
        <li>Informer les clients de tous les allergènes avant la vente</li>
      </ul>
      <p className="mb-4">Local Cooks et le Propriétaire de la cuisine NE SONT PAS responsables de l'exactitude des allergènes ; c'est la responsabilité du Chef.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">8.7 Coopération en matière d'inspection</h3>
      <p className="mb-2">Si des inspecteurs locaux/provinciaux de la salubrité alimentaire visitent la Cuisine pendant la location du Chef :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Le Chef doit coopérer pleinement avec les inspecteurs et répondre à toutes les questions de manière véridique</li>
        <li>Le Chef ne doit en aucun cas entraver ou empêcher l'inspection</li>
        <li>Le Chef doit rester sur les lieux jusqu'à ce que l'inspection soit terminée</li>
        <li>Le Chef doit fournir des documents (certificat de manipulation des aliments, étiquettes de produits, registres de procédés) sur demande</li>
      </ul>
      <p className="mb-2">Le défaut de coopération peut entraîner :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Des violations d'inspection notées contre le permis d'établissement alimentaire de la Cuisine</li>
        <li>Des contraventions ou des amendes liées au code de la santé</li>
        <li>Suspension ou révocation potentielle de la licence</li>
        <li>La suspension du Chef de la Plateforme</li>
      </ul>
      <p className="mb-4">Le Propriétaire de la cuisine est responsable de l'entretien de la Cuisine ; le Chef est responsable de la salubrité des produits alimentaires pendant la location du Chef.</p>

      <hr className="my-8" />

      {/* SECTION 9 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">9. PAIEMENTS, FRAIS ET TAXES</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.1 Frais de location et tarification</h3>
      <p className="mb-4">Le Propriétaire de la cuisine fixe les frais de location horaires de la Cuisine (par exemple, 25 $/heure). Ces frais sont affichés dans l'annonce de la Cuisine et la confirmation de Réservation.</p>
      <p className="mb-4">Le Chef accepte de payer les frais indiqués pour la période de location réservée. Les dépassements (utilisation au-delà de l'heure de fin prévue) seront facturés au taux horaire (au prorata) ou tel qu'indiqué dans la politique d'annulation du Propriétaire de la cuisine.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.2 Traitement des paiements et versements</h3>
      <p className="mb-2 font-semibold">Flux de paiement :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Le Chef soumet la Réservation et le paiement via Local Cooks (via Stripe ou un processeur similaire)</li>
        <li>Local Cooks vérifie le paiement avec le processeur (généralement 1 à 2 jours ouvrables)</li>
        <li>À la fin de la location et après confirmation du Chef (ou automatiquement 24 heures après la location) : Local Cooks verse la part du Propriétaire de la cuisine (par exemple, 80 à 85 %) dans un délai de 5 à 7 jours ouvrables</li>
        <li>Le Propriétaire de la cuisine reçoit le paiement sur son compte bancaire désigné (transfert électronique, dépôt direct, etc.)</li>
      </ul>
      <p className="mb-2 font-semibold">Remboursements :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Si le Propriétaire de la cuisine annule une Réservation, le Chef a droit à un remboursement complet (traité dans les 5 à 7 jours ouvrables)</li>
        <li>Si le Chef annule conformément à la politique d'annulation du Propriétaire de la cuisine, le montant du remboursement dépend de la politique (non remboursable, 50 %, 100 %, etc.)</li>
      </ul>
      <p className="mb-2 font-semibold">Aucune rétrofacturation :</p>
      <p className="mb-4">Le Chef s'engage à ne pas contester ou faire une rétrofacturation du paiement avec sa société de carte de crédit, à moins que Local Cooks ne parvienne pas à traiter le paiement correctement. Les rétrofacturations frauduleuses peuvent entraîner la résiliation du compte du Chef.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.3 TVH/Obligations en matière de taxes de vente</h3>
      <p className="mb-2 font-semibold">Responsabilité fiscale du Propriétaire de la cuisine :</p>
      <p className="mb-2">Si les revenus annuels du Propriétaire de la cuisine provenant de la location de cuisines dépassent 30 000 $ CA, le Propriétaire doit s'inscrire à la TPS/TVH auprès de l'Agence du revenu du Canada (ARC) et percevoir/remettre la TVH sur les frais de location.</p>
      <p className="mb-2">Local Cooks NE PERÇOIT PAS la TVH au nom des Propriétaires de cuisines. Le Propriétaire de la cuisine est seul responsable de :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Déterminer l'exigence d'inscription à la TVH</li>
        <li>S'inscrire auprès de l'ARC si nécessaire</li>
        <li>Percevoir la TVH auprès des Chefs (en facturant séparément ou en l'incluant dans les frais indiqués)</li>
        <li>Remettre la TVH à l'ARC trimestriellement ou selon les besoins</li>
        <li>Tenir des registres de toutes les locations et de la TVH perçue</li>
        <li>Produire des déclarations de revenus annuelles auprès de l'ARC et de l'administration fiscale provinciale</li>
      </ul>
      <p className="mb-2 font-semibold">Responsabilité fiscale du Chef :</p>
      <p className="mb-2">Si les revenus annuels de l'entreprise alimentaire du Chef dépassent 30 000 $ CA, le Chef doit s'inscrire à la TPS/TVH et la verser sur les ventes de produits alimentaires. Le Chef est seul responsable de :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Déterminer l'exigence d'inscription à la TVH</li>
        <li>S'inscrire auprès de l'ARC si nécessaire</li>
        <li>Percevoir la TVH auprès des clients si nécessaire</li>
        <li>Remettre la TVH à l'ARC</li>
        <li>Tenir des registres commerciaux précis</li>
        <li>Produire des déclarations de revenus auprès de l'ARC</li>
      </ul>
      <p className="mb-2 font-semibold">Responsabilité fiscale de Local Cooks :</p>
      <p className="mb-2">Les frais de Plateforme de Local Cooks sont assujettis à la TVH. Local Cooks va :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>S'inscrire à la TVH auprès de l'ARC (si ce n'est pas déjà fait)</li>
        <li>Percevoir la TVH sur les frais de Plateforme le cas échéant</li>
        <li>Remettre la TVH à l'ARC trimestriellement</li>
        <li>Fournir un rapport fiscal aux Propriétaires de cuisines chaque année (le cas échéant)</li>
      </ul>
      <p className="mb-2 font-semibold">Aucun conseil fiscal :</p>
      <p className="mb-2">Local Cooks NE FOURNIT PAS de conseils fiscaux ou comptables. Les Propriétaires de cuisines et les Chefs doivent :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Consulter un comptable ou un fiscaliste au sujet de leurs obligations en matière de TPS/TVH</li>
        <li>Tenir des registres détaillés de toutes les réservations, de tous les frais et de tous les revenus</li>
        <li>Produire des déclarations de revenus exactes auprès de l'ARC et des autorités provinciales</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">9.4 Frais de dépassement et d'entreposage</h3>
      <p className="mb-4">Toutes les pénalités et tous les frais liés aux dépassements et à l'entreposage décrits à la section 5.4 font partie des frais de Réservation et peuvent être perçus et remis par Local Cooks via la Plateforme de la même manière que les autres frais de Réservation et de service.</p>

      <hr className="my-8" />

      {/* SECTION 10 */}
      <h2 className="text-2xl font-bold mt-8 mb-4">10. UTILISATION ACCEPTABLE ET CONDUITE</h2>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.1 Conduite interdite</h3>
      <p className="mb-2">Les Utilisateurs acceptent de NE PAS :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Utiliser la Plateforme à des fins illégales ou violer la Loi applicable</li>
        <li>Préparer ou distribuer des aliments dangereux, contaminés, mal étiquetés ou faisant l'objet de fausses déclarations</li>
        <li>Faire de la discrimination, harceler, menacer ou abuser d'autres utilisateurs sur la base de caractéristiques protégées (race, sexe, religion, handicap, etc.)</li>
        <li>Se livrer à la fraude, à la fausse déclaration ou à la tromperie</li>
        <li>Accéder ou utiliser la Plateforme avec des outils automatisés (bots, scrapers) sans autorisation</li>
        <li>Faire de l'ingénierie inverse, pirater ou tenter de compromettre la sécurité de la Plateforme</li>
        <li>Perturber le fonctionnement de la Plateforme ou interférer avec l'accès des autres utilisateurs</li>
        <li>S'engager dans toute forme de falsification, de contamination ou d'adultération d'aliments</li>
        <li>Opérer sans les licences, permis ou certifications requis</li>
        <li>Sous-licencier, revendre ou transférer l'accès à la Plateforme à des parties non autorisées</li>
        <li>Publier du contenu faux, diffamatoire ou malveillant dans les profils d'utilisateurs ou les avis</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.2 Conformité aux lois</h3>
      <p className="mb-2">Tous les utilisateurs déclarent et garantissent que :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Ils sont majeurs (18 ans et plus) et ont la capacité juridique requise</li>
        <li>Ils possèdent toutes les licences, permis et certifications nécessaires exigés par la Loi applicable</li>
        <li>Ils se conformeront à toutes les lois et réglementations fédérales, provinciales, territoriales et municipales</li>
        <li>Ils se conformeront aux lois sur la salubrité alimentaire, la santé, le bâtiment, les incendies, le zonage et le travail</li>
        <li>Ils ne se livreront à aucune activité illégale</li>
        <li>Leur utilisation de la Plateforme ne viole aucun droit ni obligation de tiers</li>
      </ul>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.3 Surveillance et application</h3>
      <p className="mb-2">Local Cooks peut :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Surveiller la conduite des utilisateurs sur la Plateforme et répondre aux plaintes</li>
        <li>Demander des documents (licences, assurances, certifications) à tout moment</li>
        <li>Suspendre ou résilier des comptes pour des violations des présentes Conditions ou de la Loi applicable</li>
        <li>Coopérer avec les forces de l'ordre et les autorités réglementaires tel que requis par la loi</li>
        <li>Supprimer du contenu (messages, avis, annonces) qui viole les présentes Conditions</li>
      </ul>
      <p className="mb-4">Local Cooks n'est PAS responsable de surveiller chaque interaction ou de garantir une conformité à 100 %. Les utilisateurs sont responsables de leur propre conduite.</p>

      <h3 className="text-xl font-semibold mt-6 mb-3">10.4 Réclamations de tiers et règlement des différends</h3>
      <p className="mb-2">Si le client d'un Chef souffre d'une maladie d'origine alimentaire ou d'une blessure et dépose une réclamation contre le Chef et le Propriétaire de la cuisine :</p>
      <ul className="list-disc pl-6 mb-4">
        <li>Local Cooks ne servira pas de médiateur (il s'agit d'une question juridique entre les parties et leurs assureurs)</li>
        <li>Les deux parties doivent immédiatement informer leurs assureurs et retenir les services d'un avocat si nécessaire</li>
        <li>Les indemnisations (Section 7) régiront qui est ultimement responsable</li>
        <li>Local Cooks peut être cité à comparaître pour obtenir des informations, mais n'est pas une partie responsable</li>
      </ul>
    </>
  );
}
