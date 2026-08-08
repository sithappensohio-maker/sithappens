# Daycare multi-dog estimate math fix

Fixes a daycare estimate edge case where old `additional_dog_rate` values could be stacked with the 50% additional-dog discount.

Business rule now enforced for daycare and boarding:

- First dog pays the normal base service rate.
- Each additional dog receives 50% off that same base service rate.
- Add-ons stay full price.
- Old `additional_dog_rate` fields are ignored for daycare/boarding quotes so the discount is not applied twice.

Also added a guard in the admin booking modal so the same dog cannot be counted twice in a group booking estimate.
